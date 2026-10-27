import { InjectionToken, Provider, inject } from '@angular/core';
import { InMemoryThreadListAdapter } from '@ngx-assistant/engine';
import { createRemoteThreadListAssistantRuntime } from '../remote-thread-list/create-remote-thread-list-runtime';
import { NXA_REMOTE_THREAD_ITEM } from '../runtime-adapters';
import { NXA_ASSISTANT, provideAssistantScope } from '../scopes';
import { NXA_TRANSPORT_INITIAL_STATE } from './transport-extras';
import { createAssistantTransportThreadRuntime } from './transport-thread';
import type { AssistantTransportOptions } from './types';

const NXA_TRANSPORT_OPTIONS = new InjectionToken<AssistantTransportOptions<unknown>>(
  'NXA_TRANSPORT_OPTIONS',
);

/**
 * Provides a runtime that drives an agent on your server, plus the assistant, thread and composer
 * scopes, to an injector: `providers` of a component, a route or the app. Experimental: the API
 * can still change.
 *
 * The browser sends commands (`add-message`, `add-tool-result`, or your own through
 * `injectAssistantTransportSendCommand()`) together with the current agent state, as a JSON
 * `POST` to `api`. The server streams the new state back in the `data-stream` or
 * `assistant-transport` (SSE) protocol, and `converter` turns that state into the messages of the
 * thread. One request runs at a time: commands sent meanwhile go out together in the next one.
 * Tools of the model context that have `execute` run in the browser and their results go back as
 * `add-tool-result` commands, like the results given through `addToolResult`.
 *
 * Every request carries the thread's remote id as `threadId`. By default the threads live in
 * memory; to persist them, use this provider as the `runtime` of `provideRemoteThreadListRuntime`,
 * where it becomes the runtime of each thread. `options` can be a factory, run once in the
 * injection context when the runtime is first injected, or once per thread, in the thread's
 * injector, inside a remote thread list. Destroying the injector aborts the running
 * request without calling `onCancel`, `onError` or `onFinish`. A history adapter with
 * `unstable_copy` from `provideRuntimeAdapters` receives each settled turn of the thread.
 *
 * @example
 * ```ts
 * providers: [
 *   provideAssistantTransportRuntime({
 *     api: '/api/agent',
 *     protocol: 'assistant-transport',
 *     initialState: { messages: [] } as AgentState,
 *     converter: (state, { isSending }) => ({
 *       messages: state.messages.map(toThreadMessage),
 *       isRunning: isSending,
 *     }),
 *   }),
 * ]
 * ```
 */
export function provideAssistantTransportRuntime<T>(
  options: AssistantTransportOptions<T> | (() => AssistantTransportOptions<T>),
): Provider[] {
  return [
    {
      provide: NXA_TRANSPORT_OPTIONS,
      useFactory: () => (typeof options === 'function' ? options() : options),
    },
    ...provideAssistantScope(() => {
      const resolved = inject(NXA_TRANSPORT_OPTIONS) as AssistantTransportOptions<T>;
      // Inside a thread of a remote thread list, this is the runtime of that thread.
      const item = inject(NXA_REMOTE_THREAD_ITEM, { optional: true });
      if (item) return createAssistantTransportThreadRuntime(resolved, item);

      return createRemoteThreadListAssistantRuntime({
        adapter: new InMemoryThreadListAdapter(),
        runtime: () =>
          provideAssistantScope(() =>
            createAssistantTransportThreadRuntime(resolved, inject(NXA_REMOTE_THREAD_ITEM)!),
          ),
      });
    }),
    {
      provide: NXA_TRANSPORT_INITIAL_STATE,
      useFactory: () => ({
        assistant: inject(NXA_ASSISTANT)!,
        initialState: inject(NXA_TRANSPORT_OPTIONS).initialState,
      }),
    },
  ];
}
