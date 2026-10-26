import type {
  ChatModelAdapter,
  ThreadAssistantMessage,
  ChatModelRunOptions,
  ChatModelRunResult,
  ThreadMessage,
} from '@ngx-assistant/engine';
import {
  DataStreamAdapter,
  resetProtocolFallbackWarning,
  type DataStreamAdapterOptions,
} from './data-stream-adapter';

const userMessage: ThreadMessage = {
  id: 'user-message',
  role: 'user',
  content: [{ type: 'text', text: 'Hello' }],
  attachments: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  metadata: { custom: {} },
};

const createRunOptions = (abortSignal: AbortSignal): ChatModelRunOptions =>
  ({
    messages: [],
    runConfig: {},
    abortSignal,
    context: {},
    unstable_getMessage: () => userMessage,
  }) satisfies ChatModelRunOptions;

const runOnce = (adapter: ChatModelAdapter, options: ChatModelRunOptions) =>
  (adapter.run(options) as AsyncGenerator).next();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('posts explicit tool model content in the next request', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('data: [DONE]\n\n'));
  vi.stubGlobal('fetch', fetchMock);
  const current: ThreadMessage = {
    id: 'assistant-1',
    role: 'assistant',
    createdAt: new Date(0),
    status: { type: 'running' },
    metadata: {
      custom: {},
      steps: [],
      unstable_data: [],
      unstable_annotations: [],
      unstable_state: {},
    },
    content: [
      {
        type: 'tool-call',
        toolCallId: 'read-1',
        toolName: 'read_report',
        args: {},
        argsText: '{}',
        result: { documentId: 'report-1' },
        modelContent: [
          { type: 'text', text: 'Report contents' },
          { type: 'file', data: 'JVBERi0xLjQ=', mediaType: 'application/pdf' },
        ],
      },
    ],
  };
  const adapter = new DataStreamAdapter({
    api: '/api/chat',
    protocol: 'ui-message-stream',
  });
  await runOnce(adapter, {
    ...createRunOptions(new AbortController().signal),
    messages: [userMessage],
    unstable_getMessage: () => current,
  });
  const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
  expect(body.messages.at(-1)).toEqual({
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'read-1',
        toolName: 'read_report',
        output: {
          type: 'content',
          value: [
            { type: 'text', text: 'Report contents' },
            {
              type: 'media',
              data: 'JVBERi0xLjQ=',
              mediaType: 'application/pdf',
            },
          ],
        },
      },
    ],
  });
});

describe('DataStreamAdapter message IDs', () => {
  it('pairs followed pending calls with results when extra message fields are enabled', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('data: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetchMock);
    const pending: ThreadMessage = {
      id: 'pending',
      role: 'assistant',
      createdAt: new Date(0),
      status: { type: 'requires-action', reason: 'tool-calls' },
      metadata: {
        custom: {},
        steps: [],
        unstable_data: [],
        unstable_annotations: [],
        unstable_state: {},
      },
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'lookup',
          args: {},
          argsText: '{}',
          approval: { id: 'approval-1' },
        },
      ],
    };
    const adapter = new DataStreamAdapter({
      api: '/api/chat',
      protocol: 'ui-message-stream',
      sendExtraMessageFields: true,
    });
    await runOnce(adapter, {
      ...createRunOptions(new AbortController().signal),
      messages: [pending, userMessage],
      unstable_getMessage: () => ({
        ...pending,
        id: 'current',
        status: { type: 'running' },
        content: [],
      }),
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.messages).toEqual([
      {
        role: 'assistant',
        unstable_id: 'pending',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'lookup',
            input: {},
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'lookup',
            output: {
              type: 'error-json',
              value: { error: 'Tool call was not completed' },
            },
          },
        ],
      },
      {
        role: 'user',
        unstable_id: 'user-message',
        content: [{ type: 'text', text: 'Hello' }],
      },
    ]);
    expect(pending.status).toEqual({
      type: 'requires-action',
      reason: 'tool-calls',
    });
  });
});

describe('DataStreamAdapter cancellation', () => {
  it('invokes onCancel when the signal is already aborted before the run starts', async () => {
    const onCancel = vi.fn();
    const onError = vi.fn();
    const abortError = new DOMException('Cancelled', 'AbortError');
    const controller = new AbortController();
    controller.abort(abortError);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    const adapter = new DataStreamAdapter({
      api: '/api/chat',
      onCancel,
      onError,
    });

    await expect(runOnce(adapter, createRunOptions(controller.signal))).rejects.toBe(abortError);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not invoke onCancel when the run was aborted by a detach', async () => {
    const onCancel = vi.fn();
    const detachError = Object.assign(new DOMException('Detached', 'AbortError'), { detach: true });
    const controller = new AbortController();
    controller.abort(detachError);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(detachError));

    const adapter = new DataStreamAdapter({
      api: '/api/chat',
      onCancel,
    });

    await expect(runOnce(adapter, createRunOptions(controller.signal))).rejects.toBe(detachError);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('DataStreamAdapter response handling', () => {
  it('cancels the response body when decoder construction fails', async () => {
    const cancel = vi.fn();
    const onError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            cancel,
          }),
        ),
      ),
    );

    const adapter = new DataStreamAdapter({
      api: '/api/chat',
      protocol: 'ui-message-stream',
      maxStreamLineLength: 0,
      onError,
    });

    await expect(runOnce(adapter, createRunOptions(new AbortController().signal))).rejects.toThrow(
      'maxLineLength must be a positive safe integer',
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
  });

  it('applies the configured line limit to UI message streams', async () => {
    const onError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('data: [DONE]\n\n')));

    const adapter = new DataStreamAdapter({
      api: '/api/chat',
      protocol: 'ui-message-stream',
      maxStreamLineLength: 5,
      onError,
    });

    const consumeRun = async () => {
      for await (const chunk of adapter.run(
        createRunOptions(new AbortController().signal),
      ) as AsyncGenerator) {
        void chunk;
      }
    };

    await expect(consumeRun()).rejects.toThrow('SSE line exceeds maxLineLength');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('applies the configured line limit to data streams', async () => {
    const onError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('0:"hello"\n')));

    const adapter = new DataStreamAdapter({
      api: '/api/chat',
      protocol: 'data-stream',
      maxStreamLineLength: 4,
      onError,
    });

    const consumeRun = async () => {
      for await (const chunk of adapter.run(
        createRunOptions(new AbortController().signal),
      ) as AsyncGenerator) {
        void chunk;
      }
    };

    await expect(consumeRun()).rejects.toThrow('Stream line exceeds maxLineLength');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('reports a response that carries no body', async () => {
    const onError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null)));

    const adapter = new DataStreamAdapter({
      api: '/api/chat',
      protocol: 'ui-message-stream',
      onError,
    });

    await expect(runOnce(adapter, createRunOptions(new AbortController().signal))).rejects.toThrow(
      'Response body is null',
    );
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'Response body is null' }),
    );
  });

  it('reports a non-ok response with its status and body text', async () => {
    const onError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('gateway exploded', { status: 503 })),
    );

    const adapter = new DataStreamAdapter({ api: '/api/chat', onError });

    await expect(runOnce(adapter, createRunOptions(new AbortController().signal))).rejects.toThrow(
      'Status 503: gateway exploded',
    );
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('DataStreamAdapter tool interrupt', () => {
  const uiMessageStream = (events: readonly Record<string, unknown>[]) =>
    new Response(
      `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`,
    );

  it('reports a human interrupt as a tool error', async () => {
    const onError = vi.fn();
    const afterHuman = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        uiMessageStream([
          { type: 'start', messageId: 'assistant-1' },
          {
            type: 'tool-input-start',
            toolCallId: 'call-1',
            toolName: 'ask',
          },
          {
            type: 'tool-input-available',
            toolCallId: 'call-1',
            toolName: 'ask',
            input: {},
          },
          { type: 'finish', finishReason: 'tool-calls' },
        ]),
      ),
    );

    const adapter = new DataStreamAdapter({
      api: '/api/chat',
      protocol: 'ui-message-stream',
      onError,
    });
    const options = {
      ...createRunOptions(new AbortController().signal),
      context: {
        tools: {
          ask: {
            parameters: { type: 'object', properties: {} } as const,
            execute: async (
              _args: unknown,
              { human }: { human: (payload: unknown) => Promise<unknown> },
            ) => {
              await human({});
              afterHuman();
              return 'unreachable';
            },
          },
        },
      },
    };

    const chunks: unknown[] = [];
    for await (const chunk of adapter.run(options) as AsyncGenerator) {
      chunks.push(chunk);
    }

    expect(onError).not.toHaveBeenCalled();
    expect(afterHuman).not.toHaveBeenCalled();
    const last = chunks.at(-1) as {
      parts: { type: string; result?: unknown; isError?: boolean }[];
    };
    const parts = last.parts;
    expect(parts.find((part) => part.type === 'tool-call')).toMatchObject({
      isError: true,
      result: 'Error: Tool interrupt is not supported in data stream runtime',
    });
  });
});

describe('DataStreamAdapter protocol fallback', () => {
  /** The fallback warning is latched in a module-level flag, so each test starts unlatched. */
  const importFreshAdapter = async () => {
    resetProtocolFallbackWarning();
    return DataStreamAdapter;
  };

  const emptyStreamResponse = (headers?: Record<string, string>) =>
    new Response('data: [DONE]\n\n', headers ? { headers } : undefined);

  it('warns once when no protocol header is present and none is configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => emptyStreamResponse()),
    );

    const Adapter = await importFreshAdapter();
    const adapter = new Adapter({ api: '/api/chat' });

    await runOnce(adapter, createRunOptions(new AbortController().signal));
    await runOnce(adapter, createRunOptions(new AbortController().signal));

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('could not detect a stream');
  });

  it('stays silent when the protocol is configured explicitly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => emptyStreamResponse()),
    );

    const Adapter = await importFreshAdapter();
    const adapter = new Adapter({
      api: '/api/chat',
      protocol: 'ui-message-stream',
    });

    await runOnce(adapter, createRunOptions(new AbortController().signal));

    expect(warn).not.toHaveBeenCalled();
  });

  it('stays silent when the response advertises a protocol header', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () =>
          emptyStreamResponse({ 'x-vercel-ai-ui-message-stream': 'v1' }),
        ),
    );

    const Adapter = await importFreshAdapter();
    const adapter = new Adapter({ api: '/api/chat' });

    await runOnce(adapter, createRunOptions(new AbortController().signal));

    expect(warn).not.toHaveBeenCalled();
  });
});

describe.each(['mp3', 'wav'] as const)('DataStreamAdapter %s audio', (format) => {
  it.each([false, true])('posts an audio-only message (attachment: %s)', async (attachment) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('data: [DONE]\n\n'));
    vi.stubGlobal('fetch', fetchMock);
    const part = {
      type: 'audio' as const,
      audio: { data: 'UklGRg==', format },
    };
    const message: ThreadMessage = {
      ...userMessage,
      content: attachment ? [] : [part],
      attachments: attachment
        ? [
            {
              id: 'audio-1',
              type: 'file',
              name: `recording.${format}`,
              contentType: `audio/${format}`,
              status: { type: 'complete' },
              content: [part],
            },
          ]
        : [],
    };
    const adapter = new DataStreamAdapter({
      api: '/api/chat',
      protocol: 'ui-message-stream',
      sendExtraMessageFields: true,
    });
    await runOnce(adapter, {
      ...createRunOptions(new AbortController().signal),
      unstable_getMessage: () => message,
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.messages).toEqual([
      {
        role: 'user',
        unstable_id: message.id,
        content: [{ type: 'file', data: 'UklGRg==', mediaType: `audio/${format}` }],
      },
    ]);
  });
});

describe('DataStreamAdapter server abort', () => {
  it('retains partial text as incomplete when the client signal is still active', async () => {
    const frames = [
      { type: 'start', messageId: 'answer' },
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'An unfinished answer' },
      { type: 'abort', reason: 'Server stopped run' },
    ];
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') +
              'data: [DONE]\n\n',
            { headers: { 'x-vercel-ai-ui-message-stream': 'v1' } },
          ),
        ),
    );
    const signal = new AbortController().signal;
    const adapter = new DataStreamAdapter({ api: '/api/chat' });
    let last: ChatModelRunResult | undefined;
    for await (const update of adapter.run(createRunOptions(signal))) last = update;
    expect(signal.aborted).toBe(false);
    expect(last?.content).toEqual([
      expect.objectContaining({ type: 'text', text: 'An unfinished answer' }),
    ]);
    expect(last?.status).toEqual({ type: 'incomplete', reason: 'other' });
  });
});

const createThreadRunOptions = (abortSignal = new AbortController().signal, threadId?: string) =>
  ({
    ...createRunOptions(abortSignal),
    ...(threadId === undefined ? {} : { unstable_threadId: threadId }),
  }) satisfies ChatModelRunOptions;

const createAdapter = (options: DataStreamAdapterOptions) => new DataStreamAdapter(options);

const runToCompletion = async (adapter: ChatModelAdapter, options: ChatModelRunOptions) => {
  const result = adapter.run(options);
  if (Symbol.asyncIterator in result) {
    for await (const _ of result) void _;
  } else {
    await result;
  }
};

describe('DataStreamAdapter request errors', () => {
  it.each([
    {
      name: 'line',
      response: 'data: [DONE]\n\n',
      limits: { maxStreamLineLength: 5 },
      expectedError: 'maxLineLength',
    },
    {
      name: 'event',
      response: 'data: a\ndata: b\n\n',
      limits: { maxStreamLineLength: 7, maxStreamEventLength: 2 },
      expectedError: 'maxEventLength',
    },
  ])('forwards the configured $name limit', async (testCase) => {
    const onError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(testCase.response)));

    const adapter = createAdapter({
      api: '/api/chat',
      protocol: 'ui-message-stream',
      ...testCase.limits,
      onError,
    });

    await expect(runToCompletion(adapter, createThreadRunOptions())).rejects.toThrow(
      testCase.expectedError,
    );
    expect(onError).toHaveBeenCalledOnce();
  });

  it.each(['headers', 'body'] as const)('reports async %s resolution failures', async (option) => {
    const error = new Error(`${option} failed`);
    const onError = vi.fn();
    const resolver = vi.fn().mockRejectedValue(error);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const adapter = createAdapter({
      api: '/api/chat',
      onError,
      ...(option === 'headers' ? { headers: resolver } : { body: resolver }),
    });

    await expect(runOnce(adapter, createThreadRunOptions())).rejects.toBe(error);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports fetch failures', async () => {
    const error = new TypeError('Failed to fetch');
    const onError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));

    const adapter = createAdapter({ api: '/api/chat', onError });

    await expect(runOnce(adapter, createThreadRunOptions())).rejects.toBe(error);
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('keeps mid-stream cancellation separate from stream errors', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('Cancelled', 'AbortError');
    const onCancel = vi.fn();
    const onError = vi.fn();
    const encoder = new TextEncoder();

    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(streamController) {
            streamController.enqueue(encoder.encode('0:"Hello"\n'));
            init?.signal?.addEventListener(
              'abort',
              () => streamController.error(init.signal?.reason),
              { once: true },
            );
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { 'x-vercel-ai-data-stream': 'v1' },
          }),
        );
      }),
    );

    const adapter = createAdapter({ api: '/api/chat', onCancel, onError });
    const run = async () => {
      for await (const _ of adapter.run(
        createThreadRunOptions(controller.signal),
      ) as AsyncGenerator) {
        void _;
        controller.abort(abortError);
      }
    };

    await expect(run()).rejects.toBe(abortError);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('normalizes non-Error stream failures for onError', async () => {
    const onError = vi.fn();
    const encoder = new TextEncoder();

    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        const body = new ReadableStream<Uint8Array>({
          start(streamController) {
            streamController.enqueue(encoder.encode('0:"Hello"\n'));
            streamController.error('wire failure');
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { 'x-vercel-ai-data-stream': 'v1' },
          }),
        );
      }),
    );

    const adapter = createAdapter({ api: '/api/chat', onError });

    await expect(runToCompletion(adapter, createThreadRunOptions())).rejects.toBe('wire failure');
    expect(onError).toHaveBeenCalledExactlyOnceWith(new Error('wire failure'));
  });

  it.each(['throws', 'rejects'] as const)(
    'preserves request failures when onError %s',
    async (failureMode) => {
      const requestError = new TypeError('Failed to fetch');
      const callbackError = new Error('error callback failed');
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(requestError));

      const adapter = createAdapter({
        api: '/api/chat',
        onError: () => {
          if (failureMode === 'throws') throw callbackError;
          return Promise.reject(callbackError);
        },
      });

      await expect(runOnce(adapter, createThreadRunOptions())).rejects.toBe(requestError);
      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[ngx-assistant] onError callback threw an error',
          callbackError,
        );
      });
    },
  );

  it('keeps response callback failures separate from request errors', async () => {
    const error = new Error('response callback failed');
    const cancel = vi.fn().mockRejectedValue(new Error('cancel failed'));
    const onResponse = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            cancel,
          }),
        ),
      ),
    );

    const adapter = createAdapter({ api: '/api/chat', onResponse, onError });

    await expect(runOnce(adapter, createThreadRunOptions())).rejects.toBe(error);
    expect(onResponse).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('settles cancellation while the response callback is pending', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('Cancelled', 'AbortError');
    const cancel = vi.fn();
    const onResponse = vi.fn(() => new Promise<void>(() => undefined));
    const onCancel = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            cancel,
          }),
        ),
      ),
    );

    const adapter = createAdapter({ api: '/api/chat', onResponse, onCancel });
    const result = runOnce(adapter, createThreadRunOptions(controller.signal));
    await vi.waitFor(() => expect(onResponse).toHaveBeenCalledOnce());

    controller.abort(abortError);

    await expect(result).rejects.toBe(abortError);
    expect(cancel).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it.each(['throws', 'rejects'] as const)(
    'preserves stream failures when onError %s',
    async (failureMode) => {
      const streamError = new Error('stream failed');
      const callbackError = new Error('error callback failed');
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const body = new ReadableStream({
        start(controller) {
          controller.error(streamError);
        },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));

      const adapter = createAdapter({
        api: '/api/chat',
        protocol: 'ui-message-stream',
        onError: () => {
          if (failureMode === 'throws') throw callbackError;
          return Promise.reject(callbackError);
        },
      });

      await expect(runToCompletion(adapter, createThreadRunOptions())).rejects.toBe(streamError);
      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[ngx-assistant] onError callback threw an error',
          callbackError,
        );
      });
    },
  );

  it('keeps cancellation when a request resolver later fails', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('Cancelled', 'AbortError');
    const error = new Error('headers failed');
    const onError = vi.fn();
    let rejectHeaders: ((reason: Error) => void) | undefined;
    const headers = new Promise<Headers>((_resolve, reject) => {
      rejectHeaders = reject;
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const adapter = createAdapter({
      api: '/api/chat',
      headers: () => headers,
      onError,
    });
    const result = runOnce(adapter, createThreadRunOptions(controller.signal));

    controller.abort(abortError);
    rejectHeaders?.(error);

    await expect(result).rejects.toBe(abortError);
    expect(onError).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['headers', 'body'] as const)(
    'settles cancellation while resolving request %s',
    async (option) => {
      const controller = new AbortController();
      const abortError = new DOMException('Cancelled', 'AbortError');
      const onCancel = vi.fn();
      const onError = vi.fn();
      const pending = vi.fn(() => new Promise<never>(() => undefined));
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const adapter = createAdapter({
        api: '/api/chat',
        ...(option === 'headers' ? { headers: pending } : { body: pending }),
        onCancel,
        onError,
      });
      const result = runOnce(adapter, createThreadRunOptions(controller.signal));
      await vi.waitFor(() => expect(pending).toHaveBeenCalledOnce());

      controller.abort(abortError);

      await expect(result).rejects.toBe(abortError);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it('normalizes non-Error resolver failures for onError', async () => {
    const onError = vi.fn();
    const rejection = 'headers failed';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const adapter = createAdapter({
      api: '/api/chat',
      headers: vi.fn().mockRejectedValue(rejection),
      onError,
    });

    await expect(runOnce(adapter, createThreadRunOptions())).rejects.toBe(rejection);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toEqual(new Error(rejection));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps cancellation separate from request errors', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('Cancelled', 'AbortError');
    const onCancel = vi.fn();
    const onError = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        });
      }),
    );

    const adapter = createAdapter({
      api: '/api/chat',
      onCancel,
      onError,
    });
    const result = runOnce(adapter, createThreadRunOptions(controller.signal));

    controller.abort(abortError);

    await expect(result).rejects.toBe(abortError);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(['throws', 'rejects'] as const)(
    'keeps cancellation settled when onCancel %s',
    async (failureMode) => {
      const controller = new AbortController();
      const abortError = new DOMException('Cancelled', 'AbortError');
      const callbackError = new Error('cancel callback failed');
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.stubGlobal(
        'fetch',
        vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
              once: true,
            });
          });
        }),
      );
      const adapter = createAdapter({
        api: '/api/chat',
        onCancel: () => {
          if (failureMode === 'throws') throw callbackError;
          return Promise.reject(callbackError);
        },
      });
      const result = runOnce(adapter, createThreadRunOptions(controller.signal));

      controller.abort(abortError);

      await expect(result).rejects.toBe(abortError);
      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[ngx-assistant] onCancel callback threw an error',
          callbackError,
        );
      });
    },
  );
});

describe('DataStreamAdapter request body', () => {
  it('passes the active thread ID to body callbacks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('failed', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const body = vi.fn(async ({ threadId }: { threadId?: string }) => ({
      thread_id: threadId,
    }));
    const adapter = createAdapter({ api: '/api/chat', body });

    await expect(
      runOnce(adapter, createThreadRunOptions(undefined, 'remote-thread')),
    ).rejects.toThrow('Status 500');

    expect(body).toHaveBeenCalledExactlyOnceWith({
      threadId: 'remote-thread',
    });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(request?.body as string)).toMatchObject({
      threadId: 'remote-thread',
      thread_id: 'remote-thread',
    });
  });
});

describe('DataStreamAdapter lifecycle callbacks', () => {
  it.each(['throws', 'rejects'] as const)(
    'keeps successful responses successful when onFinish %s',
    async (failureMode) => {
      const callbackError = new Error('finish callback failed');
      const onError = vi.fn();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('data: [DONE]\n\n')));
      const adapter = createAdapter({
        api: '/api/chat',
        protocol: 'ui-message-stream',
        onFinish: () => {
          if (failureMode === 'throws') throw callbackError;
          return Promise.reject(callbackError);
        },
        onError,
      });

      await expect(runToCompletion(adapter, createThreadRunOptions())).resolves.toBeUndefined();

      expect(onError).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[ngx-assistant] onFinish callback threw an error',
          callbackError,
        );
      });
    },
  );

  it.each(['throws', 'rejects'] as const)(
    'keeps streams healthy when onData %s',
    async (failureMode) => {
      const callbackError = new Error('data callback failed');
      const onError = vi.fn();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const events = [
        { type: 'start', messageId: 'assistant' },
        { type: 'data-weather', data: { temperature: 72 } },
        { type: 'finish', finishReason: 'stop' },
      ];
      const body = `${events
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join('')}data: [DONE]\n\n`;
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
      const adapter = createAdapter({
        api: '/api/chat',
        protocol: 'ui-message-stream',
        onData: () => {
          if (failureMode === 'throws') throw callbackError;
          return Promise.reject(callbackError);
        },
        onError,
      });

      await expect(runToCompletion(adapter, createThreadRunOptions())).resolves.toBeUndefined();

      expect(onError).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          '[ngx-assistant] onData callback threw an error',
          callbackError,
        );
      });
    },
  );
});

const createAssistantMessage = (
  state: ThreadAssistantMessage['metadata']['unstable_state'],
): ThreadAssistantMessage => ({
  id: 'assistant',
  role: 'assistant',
  content: [],
  status: { type: 'running' },
  createdAt: new Date(),
  metadata: {
    unstable_state: state,
    unstable_annotations: [],
    unstable_data: [],
    steps: [],
    custom: {},
  },
});

const runWithState = async (state: ThreadAssistantMessage['metadata']['unstable_state']) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('failed', { status: 500 }));
  vi.stubGlobal('fetch', fetchMock);

  const adapter = createAdapter({ api: '/api/chat' });
  const message = createAssistantMessage(state);
  const result = adapter.run({
    messages: [],
    runConfig: {},
    abortSignal: new AbortController().signal,
    context: {},
    unstable_getMessage: () => message,
  } satisfies ChatModelRunOptions) as AsyncGenerator;

  await expect(result.next()).rejects.toThrow('Status 500');

  const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(request?.body as string) as Record<string, unknown>;
};

describe('DataStreamAdapter request state', () => {
  it.each([
    ['false', false],
    ['zero', 0],
    ['an empty string', ''],
  ])('sends %s state', async (_label, state) => {
    await expect(runWithState(state)).resolves.toMatchObject({ state });
  });

  it('omits null state', async () => {
    await expect(runWithState(null)).resolves.not.toHaveProperty('state');
  });
});
