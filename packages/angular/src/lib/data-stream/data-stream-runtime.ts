import { Provider } from '@angular/core';
import { createLocalAssistantRuntime, type LocalRuntimeOptions } from '../create-local-runtime';
import { provideAssistantScope } from '../scopes';
import { DataStreamAdapter, type DataStreamAdapterOptions } from './data-stream-adapter';

export type { DataStreamRuntimeBodyOptions } from './data-stream-adapter';
export type { DataStreamProtocol } from './protocol';

export type DataStreamRuntimeOptions = DataStreamAdapterOptions & LocalRuntimeOptions;

const splitOptions = ({
  api,
  protocol,
  onData,
  onResponse,
  onFinish,
  onError,
  onCancel,
  credentials,
  headers,
  body,
  sendExtraMessageFields,
  maxStreamLineLength,
  maxStreamEventLength,
  ...local
}: DataStreamRuntimeOptions) => ({
  adapter: {
    api,
    protocol,
    onData,
    onResponse,
    onFinish,
    onError,
    onCancel,
    credentials,
    headers,
    body,
    sendExtraMessageFields,
    maxStreamLineLength,
    maxStreamEventLength,
  } satisfies Record<keyof DataStreamAdapterOptions, unknown>,
  local: local satisfies LocalRuntimeOptions,
});

/**
 * Provides a runtime that sends each run to a streaming backend, plus the assistant, thread and
 * composer scopes, to an injector: `providers` of a component, a route or the app.
 *
 * Every run is a JSON `POST` to `api` with the conversation in the AI SDK message format, the
 * system prompt, the tools of the model context as JSON Schema, the run config, the call settings
 * and config of the model context, and last the fields of `body`, which override the others. The response is read as a UI message stream (what `toUIMessageStreamResponse()` sends)
 * or as a data stream, chosen by `protocol` or by the response's protocol header. Tools of the
 * model context that have `execute` run in the browser and their results go back to the backend
 * on the next step; a call to a tool without it stays open until `addToolResult`. Approval
 * requests sent by the backend for its own tools are not supported and are ignored.
 *
 * `options` can be a factory, run once in the injection context when the runtime is first
 * injected, so `headers` and `body` can use injected services. The rest of the lifecycle is the
 * one of `provideLocalRuntime`: destroying the injector aborts the running request.
 *
 * @example
 * ```ts
 * providers: [
 *   provideDataStreamRuntime(() => {
 *     const auth = inject(AuthService);
 *     return { api: '/api/chat', headers: async () => ({ Authorization: await auth.token() }) };
 *   }),
 * ]
 * ```
 */
export function provideDataStreamRuntime(
  options: DataStreamRuntimeOptions | (() => DataStreamRuntimeOptions),
): Provider[] {
  return provideAssistantScope(() => {
    const { adapter, local } = splitOptions(typeof options === 'function' ? options() : options);
    return createLocalAssistantRuntime(new DataStreamAdapter(adapter), local).runtime;
  });
}
