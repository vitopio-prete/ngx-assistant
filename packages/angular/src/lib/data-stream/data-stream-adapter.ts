import { isDevMode } from '@angular/core';
import {
  invokeUserCallback,
  raceWithAbortSignal,
  type ChatModelAdapter,
  type ChatModelRunOptions,
  type ThreadMessage,
} from '@ngx-assistant/engine';
import {
  AssistantMessageAccumulator,
  DataStreamDecoder,
  type AssistantStreamChunk,
  toToolsJSONSchema,
  UIMessageStreamDecoder,
  unstable_toolResultStream,
} from 'assistant-stream';
import { asAsyncIterableStream } from 'assistant-stream/utils';
import { resolveDataStreamProtocol, type DataStreamProtocol } from './protocol';
import { toLanguageModelMessages } from './to-language-model-messages';

type HeadersValue = Record<string, string> | Headers;

export interface DataStreamRuntimeBodyOptions {
  /** Id of the remote thread the run belongs to; absent while no remote thread backs the runtime. */
  threadId?: string;
}

/** What `provideDataStreamRuntime` needs to talk to the backend, besides the local runtime options. */
export interface DataStreamAdapterOptions {
  /** Endpoint that receives the run as a JSON `POST` and answers with a stream. */
  api: string;
  /** Defaults to the protocol header of the response, then `'ui-message-stream'`. */
  protocol?: DataStreamProtocol | undefined;
  /** Called for each `data-*` part (UI message stream only). */
  onData?:
    | ((data: { type: string; name: string; data: unknown; transient?: boolean }) => unknown)
    | undefined;
  /** Called with the response before its body is read; a rejection fails the run. */
  onResponse?: ((response: Response) => void | Promise<void>) | undefined;
  onFinish?: ((message: ThreadMessage) => unknown) | undefined;
  /** Called when the request or the stream fails, never for a cancelled run. */
  onError?: ((error: Error) => unknown) | undefined;
  /** Called when the user cancels the run. */
  onCancel?: (() => unknown) | undefined;
  credentials?: RequestCredentials | undefined;
  headers?: HeadersValue | (() => HeadersValue | Promise<HeadersValue>) | undefined;
  /** Extra request body fields; a callback receives the active remote thread id. */
  body?:
    | object
    | ((options: DataStreamRuntimeBodyOptions) => object | undefined | Promise<object | undefined>)
    | undefined;
  /** Adds the id of the source thread message to each serialized message as `unstable_id`. */
  sendExtraMessageFields?: boolean | undefined;
  /** Maximum UTF-16 code units accepted in one data stream or SSE line. Defaults to 16 MiB. */
  maxStreamLineLength?: number | undefined;
  /** Maximum UTF-16 code units retained across one UI message stream SSE event. Defaults to 16 MiB. */
  maxStreamEventLength?: number | undefined;
}

type DataStreamCallbackName = 'onFinish' | 'onError' | 'onCancel' | 'onData';

const invokeCallback = <TArgs extends readonly unknown[]>(
  name: DataStreamCallbackName,
  callback: ((...args: TArgs) => unknown) | undefined,
  ...args: TArgs
): void => {
  void invokeUserCallback('ngx-assistant', name, callback, ...args);
};

const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));

const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';

/**
 * The UI message stream opens a step for its `start` chunk and again for the `start-step` that
 * follows, which would count every reply twice against `maxSteps`. The first step start is held
 * until content arrives: a step start before any content replaces it. Data chunks, which belong to
 * no step, pass through meanwhile.
 */
export const mergeAdjacentStepStarts = () => {
  let held: AssistantStreamChunk | undefined;
  let seenStepStart = false;
  return new TransformStream<AssistantStreamChunk, AssistantStreamChunk>({
    transform(chunk, controller) {
      if (chunk.type === 'step-start') {
        if (!seenStepStart) {
          seenStepStart = true;
          held = chunk;
          return;
        }
        held = undefined;
      } else if (held && chunk.type !== 'data') {
        controller.enqueue(held);
        held = undefined;
      }
      controller.enqueue(chunk);
    },
    flush(controller) {
      if (held) controller.enqueue(held);
    },
  });
};

let didWarnProtocolFallback = false;

/** Lets tests observe the one-time protocol fallback warning again. */
export const resetProtocolFallbackWarning = () => {
  didWarnProtocolFallback = false;
};

/**
 * Chat model that posts each run to a streaming backend and decodes the reply. Tools of the model
 * context are sent as JSON Schema; the ones with `execute` run in the browser and their results
 * flow back into the stream.
 */
export class DataStreamAdapter implements ChatModelAdapter {
  constructor(private readonly options: DataStreamAdapterOptions) {}

  async *run({
    messages,
    runConfig,
    abortSignal,
    context,
    unstable_assistantMessageId,
    unstable_threadId,
    unstable_parentId,
    unstable_getMessage,
  }: ChatModelRunOptions) {
    const { options } = this;
    const handleAbort = () => {
      // A detach aborts the run without the user cancelling it.
      if (!abortSignal.reason?.detach) invokeCallback('onCancel', options.onCancel);
    };

    if (abortSignal.aborted) {
      handleAbort();
    } else {
      abortSignal.addEventListener('abort', handleAbort, { once: true });
    }

    let response: Response;
    try {
      const headersValue = await raceWithAbortSignal(abortSignal, () =>
        typeof options.headers === 'function' ? options.headers() : options.headers,
      );
      const bodyValue = await raceWithAbortSignal(abortSignal, () =>
        typeof options.body === 'function'
          ? options.body(unstable_threadId === undefined ? {} : { threadId: unstable_threadId })
          : options.body,
      );

      const headers = new Headers(headersValue);
      headers.set('Content-Type', 'application/json');

      const current = unstable_getMessage();
      response = await fetch(options.api, {
        method: 'POST',
        headers,
        credentials: options.credentials ?? 'same-origin',
        body: JSON.stringify({
          system: context.system,
          messages: toLanguageModelMessages([...messages, current], {
            unstable_includeId: options.sendExtraMessageFields,
          }),
          tools: toToolsJSONSchema(context.tools ?? {}),
          ...(unstable_assistantMessageId ? { unstable_assistantMessageId } : {}),
          ...(unstable_threadId ? { threadId: unstable_threadId } : {}),
          ...(unstable_parentId !== undefined ? { parentId: unstable_parentId } : {}),
          runConfig,
          state: current.metadata.unstable_state ?? undefined,
          ...context.callSettings,
          ...context.config,
          ...(bodyValue ?? {}),
        }),
        signal: abortSignal,
      });
    } catch (error: unknown) {
      abortSignal.removeEventListener('abort', handleAbort);
      if (!abortSignal.aborted && !isAbortError(error)) {
        invokeCallback('onError', options.onError, toError(error));
      }
      throw error;
    }

    try {
      await raceWithAbortSignal(abortSignal, () => options.onResponse?.(response));
    } catch (error: unknown) {
      abortSignal.removeEventListener('abort', handleAbort);
      void response.body?.cancel().catch(() => undefined);
      throw error;
    }

    try {
      if (!response.ok) {
        throw new Error(`Status ${response.status}: ${await response.text()}`);
      }
      if (!response.body) throw new Error('Response body is null');

      const { protocol, source } = resolveDataStreamProtocol(response.headers, options.protocol);
      if (source === 'fallback' && isDevMode() && !didWarnProtocolFallback) {
        didWarnProtocolFallback = true;
        console.warn(
          '[ngx-assistant] provideDataStreamRuntime could not detect a stream protocol header; falling back to "ui-message-stream". Pass protocol explicitly or expose x-vercel-ai-data-stream / x-vercel-ai-ui-message-stream from the response.',
        );
      }
      const onData = options.onData;
      const decoder =
        protocol === 'ui-message-stream'
          ? new UIMessageStreamDecoder({
              ...(onData ? { onData: (data) => invokeCallback('onData', onData, data) } : {}),
              maxLineLength: options.maxStreamLineLength,
              maxEventLength: options.maxStreamEventLength,
            })
          : new DataStreamDecoder({ maxLineLength: options.maxStreamLineLength });

      const decoded = response.body.pipeThrough(decoder);
      const stream = (
        protocol === 'ui-message-stream' ? decoded.pipeThrough(mergeAdjacentStepStarts()) : decoded
      )
        .pipeThrough(
          unstable_toolResultStream(context.tools, abortSignal, () => {
            throw new Error('Tool interrupt is not supported in data stream runtime');
          }),
        )
        .pipeThrough(new AssistantMessageAccumulator());

      yield* asAsyncIterableStream(stream);

      invokeCallback('onFinish', options.onFinish, unstable_getMessage());
    } catch (error: unknown) {
      await response.body?.cancel().catch(() => undefined);
      if (!abortSignal.aborted && !isAbortError(error)) {
        invokeCallback('onError', options.onError, toError(error));
      }
      throw error;
    } finally {
      abortSignal.removeEventListener('abort', handleAbort);
    }
  }
}
