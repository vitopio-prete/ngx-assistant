import { DestroyRef, inject } from '@angular/core';
import {
  AssistantRuntimeImpl,
  ExternalStoreRuntimeCore,
  disposeThreadRuntime,
  type AssistantRuntime,
  type ExternalStoreAdapter,
} from '@ngx-assistant/engine';
import { ExternalStoreHistoryCopy } from './external-store-history-copy';
import { injectRuntimeAdapters } from './inject-runtime-adapters';

/**
 * Creates a runtime whose messages and run state live in a store outside the engine and ties it
 * to the current injector. Shared by every provider built on the external store runtime; not part
 * of the public API. Must run in an injection context.
 *
 * `setAdapter` hands a new adapter to the runtime; its subscribers run synchronously, so callers
 * outside a store write should not call it from inside an engine callback. The model context of a
 * remote thread list is registered on the runtime. The feedback adapter of the list or of
 * `provideRuntimeAdapters` applies when the store brings none, and settled turns are copied to
 * their history adapter unless the store persists its own history or runs its own thread list.
 * When the injector is destroyed, the copy stops, the thread's in-flight work is fenced and voice,
 * dictation and speech end.
 */
export function createExternalStoreAssistantRuntime<T>(adapter: ExternalStoreAdapter<T>): {
  runtime: AssistantRuntime;
  setAdapter: (adapter: ExternalStoreAdapter<T>) => void;
} {
  const { modelContext, feedback, history } = injectRuntimeAdapters();
  const historyCopy = new ExternalStoreHistoryCopy();
  const copiesHistory = (store: ExternalStoreAdapter<T>) =>
    !!history?.unstable_copy && !store.unstable_persistsHistory && !store.adapters?.threadList;
  // The feedback adapter applies when the store brings none, and copied history records the tool
  // interactions of a store that does not record them itself.
  const adapt = (next: ExternalStoreAdapter<T>): ExternalStoreAdapter<T> => {
    const withFeedback =
      feedback && !next.adapters?.feedback
        ? { ...next, adapters: { ...next.adapters, feedback } }
        : next;
    if (!copiesHistory(next) || next.unstable_onRecordToolInteraction) return withFeedback;
    return { ...withFeedback, unstable_onRecordToolInteraction: historyCopy.recordInteraction };
  };
  const core = new ExternalStoreRuntimeCore(adapt(adapter));
  const runtime = new AssistantRuntimeImpl(core);
  const unregisterModelContext = modelContext
    ? runtime.registerModelContextProvider(modelContext)
    : undefined;

  let detachHistory: (() => void) | undefined;
  let destroyed = false;
  const syncHistoryCopy = (store: ExternalStoreAdapter<T>) => {
    if (destroyed) return;
    if (copiesHistory(store)) {
      detachHistory ??= historyCopy.attach(runtime.thread, history!);
    } else {
      detachHistory?.();
      detachHistory = undefined;
    }
  };
  syncHistoryCopy(adapter);

  // The thread list may have replaced the main thread since creation, so it is read at the end.
  inject(DestroyRef).onDestroy(() => {
    destroyed = true;
    detachHistory?.();
    unregisterModelContext?.();
    disposeThreadRuntime(core.threads.getMainThreadRuntimeCore());
  });
  return {
    runtime,
    setAdapter: (next) => {
      // A copy that stops is detached before the adapter applies, and one that starts is attached
      // after, so it counts the adapter's messages as copied.
      if (!copiesHistory(next)) syncHistoryCopy(next);
      try {
        core.setAdapter(adapt(next));
      } finally {
        syncHistoryCopy(next);
      }
    },
  };
}
