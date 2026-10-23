// Minimal signals binding for the demo. The full reactive layer will live in @ngx-assistant/angular.
import { DestroyRef, InjectionToken, Provider, Signal, inject, signal } from '@angular/core';
import type { AssistantRuntime } from '@ngx-assistant/engine';

export const NXA_ASSISTANT = new InjectionToken<AssistantRuntime>('NXA_ASSISTANT');

export const provideAssistantRuntime = (factory: () => AssistantRuntime): Provider => ({
  provide: NXA_ASSISTANT,
  useFactory: factory,
});

export const injectAssistantRuntime = () => inject(NXA_ASSISTANT);

interface Subscribable<S> {
  getState(): S;
  subscribe(callback: () => void): () => void;
}

/** Bridges any runtime (thread, composer, message…) into a Signal, unsubscribing on destroy. */
export function fromRuntime<S, T>(runtime: Subscribable<S>, select: (state: S) => T): Signal<T> {
  const value = signal(select(runtime.getState()), { equal: Object.is });
  const unsubscribe = runtime.subscribe(() => value.set(select(runtime.getState())));
  inject(DestroyRef).onDestroy(unsubscribe);
  return value.asReadonly();
}
