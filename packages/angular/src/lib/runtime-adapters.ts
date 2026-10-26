import { InjectionToken } from '@angular/core';
import type { RuntimeAdapters, ThreadListItemRuntime } from '@ngx-assistant/engine';

/**
 * Adapters a thread list hands to the runtimes of its threads: its model context, so tools and
 * instructions registered on the list reach every thread, and any history, attachment or
 * feedback adapter. The runtime providers merge them under their own adapters. Set on the
 * injector of each thread of `provideRemoteThreadListRuntime`.
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
