import {
  DOCUMENT,
  DestroyRef,
  Injector,
  effect,
  inject,
  isDevMode,
  isSignal,
  runInInjectionContext,
  untracked,
  type Signal,
} from '@angular/core';
import {
  AssistantRuntimeImpl,
  RemoteThreadListRuntimeCore,
  type AssistantRuntime,
  type RemoteThreadListAdapter,
  type RemoteThreadListRuntimeOptions as EngineOptions,
  type RemoteThreadRuntimeFactory,
} from '@ngx-assistant/engine';
import { NXA_REMOTE_THREAD_ITEM, NXA_RUNTIME_ADAPTERS } from '../runtime-adapters';
import { NXA_ASSISTANT } from '../scopes';
import type { RemoteThreadListRuntimeOptions } from './remote-thread-list-runtime';

const read = <T>(value: T | Signal<T>): T => (isSignal(value) ? untracked(value) : value);

/**
 * Creates a runtime whose threads are persisted by a `RemoteThreadListAdapter` and ties it to the
 * current injector. Shared by every provider built on the remote thread list; not part of the
 * public API. Must run in an injection context.
 */
export function createRemoteThreadListAssistantRuntime(
  options: RemoteThreadListRuntimeOptions,
): AssistantRuntime {
  const { adapter, runtime, threadId, onThreadIdChange } = options;
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
