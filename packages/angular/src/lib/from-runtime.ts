import {
  DestroyRef,
  Injector,
  Signal,
  ValueEqualityFn,
  assertInInjectionContext,
  computed,
  inject,
  signal,
} from '@angular/core';

/** The shape every engine runtime shares: a state snapshot plus change notifications. */
export interface RuntimeSubscribable<S> {
  getState(): S;
  subscribe(callback: () => void): () => void;
}

export interface FromRuntimeOptions<T> {
  /** Injector whose `DestroyRef` ends the subscription. Required outside an injection context. */
  injector?: Injector;
  /** Equality used to skip notifications when the selection did not change. Defaults to `Object.is`. */
  equal?: ValueEqualityFn<T>;
}

const identity = <T>(value: T) => value;

/**
 * Bridges a runtime (thread, composer, message, part, attachment...) into a read-only `Signal`.
 *
 * The runtime is subscribed once, and the subscription ends when the surrounding injector is
 * destroyed. The selector runs lazily, on the first read after a runtime notification, and it can
 * read other signals: a change in one of them recomputes the selection too. A notification that
 * leaves the selection equal (by `Object.is` unless `equal` is given) wakes no consumer. An error
 * thrown by the selector is rethrown on read, and the signal recovers once the selector succeeds.
 * Once the injector is destroyed, the signal keeps its last value and tracks nothing.
 *
 * Runtimes notify synchronously, so change a runtime (`composer.setText(...)`, `thread.append(...)`)
 * from event handlers, effects or lifecycle hooks, never inside a `computed` or a template
 * expression: Angular rejects the signal write that the notification causes (NG0600).
 *
 * @example
 * ```ts
 * readonly isRunning = fromRuntime(injectThread(), (s) => s.isRunning);
 * ```
 */
export function fromRuntime<S>(
  runtime: RuntimeSubscribable<S>,
  selector?: undefined,
  options?: FromRuntimeOptions<S>,
): Signal<S>;
export function fromRuntime<S, T>(
  runtime: RuntimeSubscribable<S>,
  selector: (state: S) => T,
  options?: FromRuntimeOptions<T>,
): Signal<T>;
export function fromRuntime<S, T>(
  runtime: RuntimeSubscribable<S>,
  selector: (state: S) => T = identity as (state: S) => T,
  options?: FromRuntimeOptions<T>,
): Signal<T> {
  if (!options?.injector) assertInInjectionContext(fromRuntime);
  const injector = options?.injector ?? inject(Injector);

  const version = signal(0);
  let destroyed = false;
  let last: { value: T } | undefined;
  // Registered before subscribing: an injector that is already destroyed throws here, before
  // the subscription could leak.
  injector.get(DestroyRef).onDestroy(() => {
    destroyed = true;
    unsubscribe();
  });
  const unsubscribe = runtime.subscribe(() => version.update((v) => v + 1));

  return computed(
    () => {
      version();
      if (destroyed && last) return last.value;
      const value = selector(runtime.getState());
      last = { value };
      return value;
    },
    { equal: options?.equal ?? Object.is },
  );
}
