import { Provider, Signal, effect, isSignal, untracked } from '@angular/core';
import type { ExternalStoreAdapter } from '@ngx-assistant/engine';
import { createExternalStoreAssistantRuntime } from './create-external-store-runtime';
import { provideAssistantScope } from './scopes';

type AdapterSource<T> = ExternalStoreAdapter<T> | Signal<ExternalStoreAdapter<T>>;

/**
 * Provides a runtime whose messages and run state live in your own store, plus the assistant,
 * thread and composer scopes, to an injector: `providers` of a component, a route or the app.
 *
 * `adapter` is an adapter, a `Signal` of one, or a factory returning either, run once in the
 * injection context when the runtime is first injected. A signal keeps the runtime in sync: each
 * new adapter it holds is handed to the runtime by an effect, so a runtime call made in the same
 * task as a store write still sees the previous adapter until the next change detection. A plain
 * adapter is read once. When the injector is destroyed, the thread's in-flight work is fenced and
 * voice, dictation and speech end; `onCancel` is not called, so a run in your store goes on.
 * Inside a thread of a remote thread list, the list's model context is registered on the runtime.
 * A feedback adapter from `provideRuntimeAdapters` applies when the store brings none.
 *
 * @example
 * ```ts
 * providers: [
 *   provideExternalStoreRuntime(() => {
 *     const store = inject(ChatStore);
 *     return computed(() => ({
 *       messages: store.messages(),
 *       isRunning: store.isRunning(),
 *       onNew: (message) => store.send(message),
 *     }));
 *   }),
 * ]
 * ```
 */
export function provideExternalStoreRuntime<T>(
  adapter: AdapterSource<T> | (() => AdapterSource<T>),
): Provider[] {
  return provideAssistantScope(() => {
    const source = isSignal(adapter) || typeof adapter !== 'function' ? adapter : adapter();
    const store = isSignal(source) ? source : undefined;
    let current = store ? untracked(store) : (source as ExternalStoreAdapter<T>);
    const { runtime, setAdapter } = createExternalStoreAssistantRuntime(current);

    if (store) {
      effect(() => {
        const next = store();
        if (next === current) return;
        // Subscribers run synchronously here, and what they read must not become a dependency.
        untracked(() => setAdapter(next));
        current = next;
      });
    }
    return runtime;
  });
}
