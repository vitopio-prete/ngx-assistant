import { Provider, Signal } from '@angular/core';
import type { RemoteThreadListAdapter } from '@ngx-assistant/engine';
import { provideAssistantScope } from '../scopes';
import { createRemoteThreadListAssistantRuntime } from './create-remote-thread-list-runtime';

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
  return provideAssistantScope(() =>
    createRemoteThreadListAssistantRuntime(typeof options === 'function' ? options() : options),
  );
}
