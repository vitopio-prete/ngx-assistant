import {
  EnvironmentInjector,
  InjectionToken,
  createEnvironmentInjector,
  inject,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  AssistantRuntime,
  ThreadAssistantMessage,
  ThreadMessage,
} from '@ngx-assistant/engine';
import { injectAssistant } from '../scopes';
import { provideDataStreamRuntime, type DataStreamRuntimeOptions } from './data-stream-runtime';

type Chunk = Record<string, unknown>;

const sse = (chunks: readonly Chunk[]) =>
  `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;

const uiMessageStream = (chunks: readonly Chunk[]) =>
  new Response(sse(chunks), { headers: { 'x-vercel-ai-ui-message-stream': 'v1' } });

const textReply = (text: string): Chunk[] => [
  { type: 'start', messageId: 'reply' },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: text },
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: 'stop' },
];

const toolCall = (toolName: string, input: unknown, extra: Chunk[] = []): Chunk[] => [
  { type: 'start', messageId: 'reply' },
  { type: 'tool-input-start', toolCallId: 'call-1', toolName },
  { type: 'tool-input-available', toolCallId: 'call-1', toolName, input },
  ...extra,
  { type: 'finish', finishReason: 'tool-calls' },
];

/** A fetch whose responses are queued per call; records each request body. */
const stubFetch = (...responses: (() => Response)[]) => {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return next();
  });
  vi.stubGlobal('fetch', fetchMock);
  const bodies = () =>
    fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(init!.body as string) as Record<string, unknown>,
    );
  return { fetchMock, bodies };
};

/** A fetch that streams one data stream chunk, then waits until the request is aborted. */
const stubBlockingFetch = () => {
  const signals: AbortSignal[] = [];
  const encoder = new TextEncoder();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init!.signal!;
      signals.push(signal);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('0:"partial"\n'));
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        },
      });
      return new Response(body, { headers: { 'x-vercel-ai-data-stream': 'v1' } });
    }),
  );
  return signals;
};

const injectorWith = (...providers: Parameters<typeof createEnvironmentInjector>[0]) =>
  createEnvironmentInjector(providers, TestBed.inject(EnvironmentInjector));

const setup = (options: DataStreamRuntimeOptions) => {
  const injector = injectorWith(provideDataStreamRuntime(options));
  const assistant = injector.runInContext(() => injectAssistant());
  return { injector, assistant, thread: assistant.thread };
};

const send = ({ thread }: AssistantRuntime, text: string) => {
  thread.composer.setText(text);
  thread.composer.send();
};

const lastAssistant = ({ thread }: AssistantRuntime) => {
  const last = thread.getState().messages.at(-1);
  return last?.role === 'assistant' ? (last as ThreadAssistantMessage) : undefined;
};

const waitForStatus = (
  assistant: AssistantRuntime,
  type: ThreadAssistantMessage['status']['type'],
) => vi.waitFor(() => expect(lastAssistant(assistant)?.status.type).toBe(type));

const textOf = (message: ThreadMessage | undefined) =>
  message?.content.map((part) => (part.type === 'text' ? part.text : '')).join('');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('provideDataStreamRuntime', () => {
  it('posts the conversation and streams a UI message stream reply into the thread', async () => {
    const { fetchMock, bodies } = stubFetch(() => uiMessageStream(textReply('Hi there')));
    const { injector, assistant } = setup({ api: '/api/chat' });

    send(assistant, 'Hello');
    await waitForStatus(assistant, 'complete');

    expect(textOf(lastAssistant(assistant))).toBe('Hi there');
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/chat',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
    expect(bodies()[0]).toMatchObject({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      tools: {},
    });
    injector.destroy();
  });

  it('reads a data stream when the response says so', async () => {
    stubFetch(
      () =>
        new Response('0:"Hello "\n0:"world"\n', {
          headers: { 'x-vercel-ai-data-stream': 'v1' },
        }),
    );
    const { injector, assistant } = setup({ api: '/api/chat' });

    send(assistant, 'Hi');
    await vi.waitFor(() => expect(textOf(lastAssistant(assistant))).toBe('Hello world'));
    await vi.waitFor(() => expect(assistant.thread.getState().isRunning).toBe(false));
    injector.destroy();
  });

  it('sends no thread id and calls body with no options outside a remote thread list', async () => {
    const { bodies } = stubFetch(() => uiMessageStream(textReply('ok')));
    const body = vi.fn(async () => ({ extra: 1 }));
    const onError = vi.fn();
    const { injector, assistant } = setup({ api: '/api/chat', body, onError });

    send(assistant, 'Hello');
    await waitForStatus(assistant, 'complete');

    expect(body).toHaveBeenCalledExactlyOnceWith({});
    expect(bodies()[0]).toMatchObject({ extra: 1 });
    expect(bodies()[0]).not.toHaveProperty('threadId');
    expect(onError).not.toHaveBeenCalled();
    injector.destroy();
  });

  it('cancels a run mid-stream: the request is aborted and the reply kept as incomplete', async () => {
    const signals = stubBlockingFetch();
    const onCancel = vi.fn();
    const onError = vi.fn();
    const { injector, assistant } = setup({ api: '/api/chat', onCancel, onError });

    send(assistant, 'Hello');
    await vi.waitFor(() => expect(textOf(lastAssistant(assistant))).toBe('partial'));
    assistant.thread.cancelRun();

    await waitForStatus(assistant, 'incomplete');
    expect(lastAssistant(assistant)?.status).toMatchObject({ reason: 'cancelled' });
    expect(signals[0]!.aborted).toBe(true);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    injector.destroy();
  });

  it('aborts the running request without onCancel when the injector is destroyed', async () => {
    const signals = stubBlockingFetch();
    const onCancel = vi.fn();
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, 'error');
    const { injector, assistant } = setup({ api: '/api/chat', onCancel, onError });

    send(assistant, 'Hello');
    await vi.waitFor(() => expect(textOf(lastAssistant(assistant))).toBe('partial'));
    injector.destroy();

    expect(signals[0]!.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('cancels a run while the request headers are still resolving', async () => {
    const { fetchMock } = stubFetch();
    const headers = vi.fn(() => new Promise<Record<string, string>>(() => undefined));
    const onCancel = vi.fn();
    const onError = vi.fn();
    const { injector, assistant } = setup({ api: '/api/chat', headers, onCancel, onError });

    send(assistant, 'Hello');
    await vi.waitFor(() => expect(headers).toHaveBeenCalledOnce());
    assistant.thread.cancelRun();

    await waitForStatus(assistant, 'incomplete');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    injector.destroy();
  });

  it('hands the request options to the backend call', async () => {
    const { fetchMock, bodies } = stubFetch(() =>
      uiMessageStream([
        { type: 'start', messageId: 'reply' },
        { type: 'data-weather', data: { sky: 'sunny' } },
        ...textReply('done').slice(1),
      ]),
    );
    const onResponse = vi.fn();
    const onData = vi.fn();
    const onFinish = vi.fn();
    const { injector, assistant } = setup({
      api: '/api/chat',
      headers: { Authorization: 'Bearer token' },
      credentials: 'include',
      sendExtraMessageFields: true,
      onResponse,
      onData,
      onFinish,
    });

    send(assistant, 'Hello');
    await waitForStatus(assistant, 'complete');

    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.credentials).toBe('include');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token');
    expect(bodies()[0]!['messages']).toEqual([
      expect.objectContaining({ role: 'user', unstable_id: expect.any(String) }),
    ]);
    expect(onResponse).toHaveBeenCalledExactlyOnceWith(expect.any(Response));
    expect(onData).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: 'weather', data: { sky: 'sunny' } }),
    );
    await vi.waitFor(() =>
      expect(onFinish).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ role: 'assistant' }),
      ),
    );
    injector.destroy();
  });

  it('hands the local runtime options to the runtime', async () => {
    const { bodies } = stubFetch(() => uiMessageStream(toolCall('weather', { city: 'Rome' })));
    const execute = vi.fn(async () => ({ sky: 'sunny' }));
    const { injector, assistant } = setup({ api: '/api/chat', maxSteps: 1 });
    assistant.registerModelContextProvider({
      getModelContext: () => ({
        tools: { weather: { parameters: { type: 'object', properties: {} }, execute } },
      }),
    });

    send(assistant, 'Weather?');
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(assistant.thread.getState().isRunning).toBe(false));

    // With maxSteps 1 the tool result does not start a second request.
    expect(bodies()).toHaveLength(1);
    injector.destroy();
  });

  it('runs an options factory once, in the injection context', async () => {
    const API = new InjectionToken<string>('API');
    const factory = vi.fn(() => ({ api: inject(API) }));
    const { fetchMock } = stubFetch(
      () => uiMessageStream(textReply('one')),
      () => uiMessageStream(textReply('two')),
    );
    const injector = injectorWith(
      { provide: API, useValue: '/from-di' },
      provideDataStreamRuntime(factory),
    );
    const assistant = injector.runInContext(() => injectAssistant());

    send(assistant, 'first');
    await waitForStatus(assistant, 'complete');
    send(assistant, 'second');
    await vi.waitFor(() => expect(textOf(lastAssistant(assistant))).toBe('two'));

    expect(factory).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/from-di', '/from-di']);
    injector.destroy();
  });

  it('passes local runtime options through to the runtime', async () => {
    stubFetch();
    const { injector, assistant } = setup({
      api: '/api/chat',
      initialMessages: [{ role: 'user', content: 'from history' }],
    });

    expect(textOf(assistant.thread.getState().messages[0])).toBe('from history');
    injector.destroy();
  });

  it('runs a browser tool of the model context and sends its result on the next step', async () => {
    const { bodies } = stubFetch(
      () => uiMessageStream(toolCall('weather', { city: 'Rome' })),
      () => uiMessageStream(textReply('It is sunny')),
    );
    const execute = vi.fn(async ({ city }: { city: string }) => ({ city, sky: 'sunny' }));
    const { injector, assistant } = setup({ api: '/api/chat' });
    assistant.registerModelContextProvider({
      getModelContext: () => ({
        tools: {
          weather: {
            description: 'Current weather',
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
            execute,
          },
        },
      }),
    });

    send(assistant, 'Weather in Rome?');
    await vi.waitFor(() => expect(textOf(lastAssistant(assistant))).toBe('It is sunny'));

    expect(execute).toHaveBeenCalledWith({ city: 'Rome' }, expect.anything());
    expect(bodies()[0]!['tools']).toMatchObject({
      weather: { description: 'Current weather', parameters: { type: 'object' } },
    });
    expect(bodies()[1]!['messages']).toContainEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'weather',
          output: { type: 'json', value: { city: 'Rome', sky: 'sunny' } },
        },
      ],
    });
    injector.destroy();
  });

  it('leaves a call to a tool without execute open until addResult, then resumes the run', async () => {
    const { bodies } = stubFetch(
      () => uiMessageStream(toolCall('confirm', { action: 'delete' })),
      () => uiMessageStream(textReply('Deleted')),
    );
    const { injector, assistant } = setup({ api: '/api/chat' });

    send(assistant, 'Delete it');
    await waitForStatus(assistant, 'requires-action');
    expect(bodies()).toHaveLength(1);

    const reply = lastAssistant(assistant)!;
    assistant.thread
      .getMessageById(reply.id)
      .getMessagePartByToolCallId('call-1')
      .addToolResult({ approved: true });

    await vi.waitFor(() => expect(textOf(lastAssistant(assistant))).toContain('Deleted'));
    expect(bodies()[1]!['messages']).toContainEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'confirm',
          output: { type: 'json', value: { approved: true } },
        },
      ],
    });
    injector.destroy();
  });

  it('ignores a server tool approval request without failing the run', async () => {
    stubFetch(() =>
      uiMessageStream(
        toolCall('deleteFile', { path: 'a.txt' }, [
          { type: 'tool-approval-request', approvalId: 'approval-1', toolCallId: 'call-1' },
        ]),
      ),
    );
    const onError = vi.fn();
    const { injector, assistant } = setup({ api: '/api/chat', onError });

    send(assistant, 'Delete a.txt');
    await waitForStatus(assistant, 'requires-action');

    const part = lastAssistant(assistant)!.content.find((p) => p.type === 'tool-call');
    expect(part).toMatchObject({ toolCallId: 'call-1', toolName: 'deleteFile' });
    expect(part).not.toHaveProperty('result');
    expect(part).not.toHaveProperty('isError');
    expect(part).not.toHaveProperty('approval');
    expect(onError).not.toHaveBeenCalled();
    injector.destroy();
  });

  it('reports a failed response as a thread error and through onError', async () => {
    stubFetch(() => new Response('boom', { status: 500 }));
    const onError = vi.fn();
    const { injector, assistant } = setup({ api: '/api/chat', onError });

    send(assistant, 'Hello');
    await waitForStatus(assistant, 'incomplete');

    expect(lastAssistant(assistant)?.status).toMatchObject({
      reason: 'error',
      error: expect.objectContaining({ message: 'Status 500: boom' }),
    });
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'Status 500: boom' }),
    );
    injector.destroy();
  });
});
