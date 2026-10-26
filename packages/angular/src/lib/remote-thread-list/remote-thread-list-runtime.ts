import {
  DOCUMENT,
  DestroyRef,
  Injector,
  Provider,
  Signal,
  effect,
  inject,
  isDevMode,
  isSignal,
  runInInjectionContext,
  untracked,
} from '@angular/core';
import {
  AssistantRuntimeImpl,
  RemoteThreadListRuntimeCore,
  type RemoteThreadListAdapter,
  type RemoteThreadListRuntimeOptions as EngineOptions,
  type RemoteThreadRuntimeFactory,
} from '@ngx-assistant/engine';
import { NXA_REMOTE_THREAD_ITEM, NXA_RUNTIME_ADAPTERS } from '../runtime-adapters';
import { NXA_ASSISTANT, provideAssistantScope } from '../scopes';

export interface RemoteThreadListRuntimeOptions {
  /**
   * Persists the threads: lists, creates, renames, archives and deletes them, and generates
   * titles. A `Signal` of one keeps the runtime in sync; a new adapter reloads the list.
   */
  adapter: RemoteThreadListAdapter | Signal<RemoteThreadListAdapter>;
  /**
   * The providers of the runtime of one thread, such as `provideLocalRuntime(...)` or
   * `provideDataStreamRuntime(...)`. Called for each thread the list starts; the providers go on a
   * child injector of the one the list is provided on, destroyed with the thread. Called in the
   * injection context of the list's injector.
   */
  runtime: () => Provider[];
  /**
   * The thread to show, by remote id; `undefined` shows a new thread. When the signal changes, the
   * runtime switches to that thread.
   */
  threadId?: Signal<string | undefined> | undefined;
  /**
   * Called when the runtime changes the remote id of the thread it shows. Switches made through
   * `threadId` are not echoed back. A new thread reports its remote id once it is initialized.
   */
  onThreadIdChange?: ((threadId: string | undefined) => void) | undefined;
}

const read = <T>(value: T | Signal<T>): T => (isSignal(value) ? untracked(value) : value);

/**
 * Provides a runtime whose threads are persisted by a `RemoteThreadListAdapter`, plus the
 * assistant, thread and composer scopes, to an injector: `providers` of a component, a route or
 * the app.
 *
 * Each started thread runs on its own runtime, made from the `runtime` providers on a child
 * injector. That injector also holds the thread's list item (`NXA_REMOTE_THREAD_ITEM`) and the
 * list's adapters (`NXA_RUNTIME_ADAPTERS`), so tools and instructions registered on this runtime
 * reach every thread. Stopping a thread (deleting it, replacing the adapter, destroying the list)
 * destroys its injector, which aborts its running request. A thread the user switches away from
 * keeps its runtime, and a run in it goes on, until the thread is stopped.
 *
 * `options` can be a factory, run once in the injection context when the runtime is first
 * injected. `adapter` and `threadId` signals are handed to the runtime by an effect. The list
 * reloads after a failed load when the browser comes back online or the page becomes visible.
 *
 * @example
 * ```ts
 * providers: [
 *   provideRemoteThreadListRuntime(() => ({
 *     adapter: inject(ThreadsAdapter),
 *     runtime: () => provideDataStreamRuntime({ api: '/api/chat' }),
 *   })),
 * ]
 * ```
 */
export function provideRemoteThreadListRuntime(
  options: RemoteThreadListRuntimeOptions | (() => RemoteThreadListRuntimeOptions),
): Provider[] {
  return provideAssistantScope(() => {
    const { adapter, runtime, threadId, onThreadIdChange } =
      typeof options === 'function' ? options() : options;
    const parent = inject(Injector);

    const threadRuntime: RemoteThreadRuntimeFactory = ({ item, adapters }) => {
      const injector = Injector.create({
        parent,
        providers: [
          { provide: NXA_REMOTE_THREAD_ITEM, useValue: item },
          { provide: NXA_RUNTIME_ADAPTERS, useValue: adapters },
          runInInjectionContext(parent, runtime),
        ],
      });
      try {
        const assistant = injector.get(NXA_ASSISTANT, null, { self: true });
        if (!assistant) {
          throw new Error(
            '[ngx-assistant] The runtime providers of a remote thread list provide no runtime: ' +
              'return a runtime provider such as provideLocalRuntime(...).',
          );
        }
        return { runtime: assistant, dispose: () => injector.destroy() };
      } catch (error) {
        injector.destroy();
        throw error;
      }
    };

    const optionsOf = (): EngineOptions => ({
      adapter: read(adapter),
      threadId: threadId ? untracked(threadId) : undefined,
      onThreadIdChange,
      threadRuntime,
    });
    let current = optionsOf();
    warnAboutFrameworkAdapters(current.adapter);
    const core = new RemoteThreadListRuntimeCore(current);
    const threads = core.threads;
    void threads.__internal_load();

    if (isSignal(adapter) || threadId) {
      effect(() => {
        const nextAdapter = isSignal(adapter) ? adapter() : adapter;
        const nextThreadId = threadId?.();
        if (nextAdapter === current.adapter && nextThreadId === current.threadId) return;
        // Subscribers run synchronously here, and what they read must not become a dependency.
        untracked(() => {
          const adapterChanged = nextAdapter !== current.adapter;
          if (adapterChanged) warnAboutFrameworkAdapters(nextAdapter);
          current = { ...current, adapter: nextAdapter, threadId: nextThreadId };
          threads.__internal_setOptions(current);
          if (adapterChanged) void threads.__internal_load();
        });
      });
    }

    const stopReloading = reloadAfterErrors(threads);
    inject(DestroyRef).onDestroy(() => {
      stopReloading();
      threads.__internal_dispose();
    });
    return new AssistantRuntimeImpl(core);
  });
}

// Per-thread adapters supplied through framework components or hooks have no meaning here.
function warnAboutFrameworkAdapters(adapter: RemoteThreadListAdapter) {
  if (!isDevMode()) return;
  if (adapter.unstable_Provider !== undefined || adapter.unstable_useAdapters !== undefined) {
    console.warn(
      '[ngx-assistant] provideRemoteThreadListRuntime ignores unstable_Provider and ' +
        'unstable_useAdapters on the adapter: pass per-thread adapters in the runtime options, ' +
        'using NXA_REMOTE_THREAD_ITEM to know the thread.',
    );
  }
}

// A failed load is retried when the browser comes back online or the page becomes visible.
function reloadAfterErrors(threads: RemoteThreadListRuntimeCore['threads']): () => void {
  const document = inject(DOCUMENT, { optional: true });
  const window = document?.defaultView;
  if (!document || !window) return () => undefined;

  const reloadAfterError = () => {
    if (threads.loadError !== undefined) void threads.reload();
    threads.__internal_retryControlledThread();
  };
  const reloadAfterVisible = () => {
    if (document.visibilityState === 'visible') reloadAfterError();
  };
  window.addEventListener('online', reloadAfterError);
  document.addEventListener('visibilitychange', reloadAfterVisible);
  return () => {
    window.removeEventListener('online', reloadAfterError);
    document.removeEventListener('visibilitychange', reloadAfterVisible);
  };
}
