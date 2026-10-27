import { DestroyRef, Signal, computed, effect, inject, untracked } from '@angular/core';
import type { AssistantRuntime, ModelContext } from '@ngx-assistant/engine';

/** A value, or a function that reads signals and returns it; the function form is tracked. */
export type MaybeReactive<T> = T | (() => T);

export const readMaybeReactive = <T>(value: MaybeReactive<T>): T =>
  typeof value === 'function' ? (value as () => T)() : value;

const UNSET = Symbol('unset');

/**
 * Registers on `runtime`, for the life of the current injector, the model context that `read`
 * returns: a function the runtime calls each time it needs the context (on every send). `read`
 * is tracked: the runtime always gets the latest value, and when the signals it reads change, it
 * is notified (`modelContextUpdate`). The provider keeps its place among the others, so its priority
 * against them does not change. Must run in an injection context.
 *
 * `read` runs only when the runtime asks for the context or when the effect runs, never during
 * the call: it can read the required inputs of a component that calls this in its constructor.
 */
export function registerModelContext(
  runtime: AssistantRuntime,
  read: () => () => ModelContext,
): void {
  const source = computed(read);
  const registration: { unregister?: () => void } = {};
  // Registered first, so a failure below cannot leave the provider on the runtime.
  inject(DestroyRef).onDestroy(() => registration.unregister?.());

  let current: (() => ModelContext) | typeof UNSET = UNSET;
  let observed = false;
  const listeners = new Set<() => void>();
  effect(() => {
    const next = source();
    const first = current === UNSET;
    if (next === current) return;
    current = next;
    // The first run only records the value, unless the runtime may have seen an older one.
    if (first && !observed) return;
    untracked(() => {
      for (const listener of [...listeners]) listener();
    });
  });

  registration.unregister = runtime.registerModelContextProvider({
    // Read from the computed, not from `current`: a send can come before the effect has run.
    getModelContext: () => {
      observed = true;
      return untracked(() => source()());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

/**
 * Runs `bind` with the value of `source`, and again each time it changes, undoing the previous run
 * first; the last run is undone when the current injector is destroyed. The first run happens now
 * with `eager`, else when the effect first runs (so `source` may read required inputs). Must run in
 * an injection context.
 */
export function bindLatest<T>(
  source: Signal<T>,
  bind: (value: T) => (() => void) | void,
  { eager = false }: { eager?: boolean } = {},
): void {
  let undo: (() => void) | void = undefined;
  inject(DestroyRef).onDestroy(() => undo?.());

  let value: T | typeof UNSET = UNSET;
  const run = (next: T) => {
    value = next;
    untracked(() => {
      undo?.();
      undo = undefined;
      undo = bind(next);
    });
  };
  if (eager) run(untracked(source));
  effect(() => {
    const next = source();
    if (value !== UNSET && Object.is(next, value)) return;
    run(next);
  });
}
