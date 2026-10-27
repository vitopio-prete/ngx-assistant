import { DestroyRef, inject } from '@angular/core';
import {
  AssistantRuntimeImpl,
  ExternalStoreRuntimeCore,
  disposeThreadRuntime,
  type AssistantRuntime,
  type ExternalStoreAdapter,
} from '@ngx-assistant/engine';
import { NXA_RUNTIME_ADAPTERS } from './runtime-adapters';

/**
 * Creates a runtime whose messages and run state live in a store outside the engine and ties it
 * to the current injector. Shared by every provider built on the external store runtime; not part
 * of the public API. Must run in an injection context.
 *
 * `setAdapter` hands a new adapter to the runtime; its subscribers run synchronously, so callers
 * outside a store write should not call it from inside an engine callback. Inside a thread of a
 * remote thread list, the list's model context is registered on the runtime and its feedback
 * adapter applies when the store brings none. When the injector is destroyed, the thread's
 * in-flight work is fenced and voice, dictation and speech end.
 */
export function createExternalStoreAssistantRuntime<T>(adapter: ExternalStoreAdapter<T>): {
  runtime: AssistantRuntime;
  setAdapter: (adapter: ExternalStoreAdapter<T>) => void;
} {
  const { modelContext, feedback } = inject(NXA_RUNTIME_ADAPTERS, { optional: true }) ?? {};
  // The feedback adapter of a thread list applies when the store brings none.
  const adapt = (next: ExternalStoreAdapter<T>): ExternalStoreAdapter<T> =>
    feedback && !next.adapters?.feedback
      ? { ...next, adapters: { ...next.adapters, feedback } }
      : next;
  const core = new ExternalStoreRuntimeCore(adapt(adapter));
  const runtime = new AssistantRuntimeImpl(core);
  const unregisterModelContext = modelContext
    ? runtime.registerModelContextProvider(modelContext)
    : undefined;
  // The thread list may have replaced the main thread since creation, so it is read at the end.
  inject(DestroyRef).onDestroy(() => {
    unregisterModelContext?.();
    disposeThreadRuntime(core.threads.getMainThreadRuntimeCore());
  });
  return { runtime, setAdapter: (next) => core.setAdapter(adapt(next)) };
}
