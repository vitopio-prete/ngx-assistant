import { InjectionToken, inject, type Provider } from '@angular/core';
import type { RuntimeAdapters, ThreadListItemRuntime } from '@ngx-assistant/engine';
import { NXA_PROVIDED_RUNTIME_ADAPTERS } from './provided-runtime-adapters';

/**
 * Adapters a thread list hands to the runtimes of its threads: its model context, so tools and
 * instructions registered on the list reach every thread. The runtime providers merge them under
 * their own adapters. Set on the injector of each thread of `provideRemoteThreadListRuntime`;
 * adapters for one thread, such as its history, come from `provideRuntimeAdapters`.
 */
export const NXA_RUNTIME_ADAPTERS = new InjectionToken<RuntimeAdapters | null>(
  'NXA_RUNTIME_ADAPTERS',
);

/**
 * The thread list item of the thread a runtime is created for, on the injector of each thread of
 * `provideRemoteThreadListRuntime`. A runtime factory can read its remote id, for example to
 * build a history adapter for that thread.
 */
export const NXA_REMOTE_THREAD_ITEM = new InjectionToken<ThreadListItemRuntime | null>(
  'NXA_REMOTE_THREAD_ITEM',
);

/** The adapters `provideRuntimeAdapters` hands to the runtime providers of its injector. */
export type ProvidedRuntimeAdapters = Omit<RuntimeAdapters, 'modelContext'>;

/**
 * Provides history, attachment and feedback adapters to the runtime providers of an injector and
 * of the injectors below it. Adapters given here apply over those of an outer
 * `provideRuntimeAdapters`, and a runtime's own adapters apply over both. Within one injector the
 * last `provideRuntimeAdapters` wins, so give it all the adapters of that injector at once.
 *
 * `provideLocalRuntime` and `provideDataStreamRuntime` load and append their messages through
 * the history adapter and use the attachment and feedback adapters. `provideExternalStoreRuntime`
 * and `provideAssistantTransportRuntime` keep their messages in a store: they use the feedback
 * adapter when the store brings none, and copy each settled turn to a history adapter with
 * `unstable_copy`, unless the store persists its own history (`unstable_persistsHistory`) or runs
 * its own thread list. Their attachments come only from the store.
 *
 * `adapters` is an object, or a factory run in the injection context when the first runtime
 * reads it, which is how a thread of `provideRemoteThreadListRuntime` builds adapters for itself.
 *
 * @example
 * ```ts
 * provideRemoteThreadListRuntime({
 *   adapter: threadList,
 *   runtime: () => [
 *     provideRuntimeAdapters(() => ({ history: historyFor(inject(NXA_REMOTE_THREAD_ITEM)!) })),
 *     provideAssistantTransportRuntime({ api: '/api/agent', initialState, converter }),
 *   ],
 * });
 * ```
 */
export function provideRuntimeAdapters(
  adapters: ProvidedRuntimeAdapters | (() => ProvidedRuntimeAdapters),
): Provider {
  return {
    provide: NXA_PROVIDED_RUNTIME_ADAPTERS,
    useFactory: (): ProvidedRuntimeAdapters => ({
      ...inject(NXA_PROVIDED_RUNTIME_ADAPTERS, { optional: true, skipSelf: true }),
      ...(typeof adapters === 'function' ? adapters() : adapters),
    }),
  };
}
