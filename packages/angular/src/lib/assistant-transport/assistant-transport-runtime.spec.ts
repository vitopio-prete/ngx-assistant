import {
  EnvironmentInjector,
  type Provider,
  createEnvironmentInjector,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { AssistantRuntime, ThreadMessage } from '@ngx-assistant/engine';
import { ToolResponse } from 'assistant-stream';
import { injectAssistant } from '../scopes';
import { provideAssistantTransportRuntime } from './assistant-transport-runtime';
import { REPLAY_CONTENT_LENGTH_HEADER } from './replay-boundary-stream';
import { injectAssistantTransportSendCommand } from './transport-state';
import type {
  AssistantTransportCommand,
  AssistantTransportOptions,
  AssistantTransportStateConverter,
} from './types';

const API = 'https://example.com/api';
const RESUME_API = 'https://example.com/resume';
const RESUME_STATE_API = 'https://example.com/resume-state';

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

const waitFor = (assertion: () => void) => vi.waitFor(assertion, { interval: 10 });

const converter: AssistantTransportStateConverter<unknown> = (_state, meta) => ({
  messages: [],
  isRunning: meta.isSending,
});

const createMessageCommand = (text: string, id?: string): AssistantTransportCommand => ({
  type: 'add-message',
  message: { role: 'user', ...(id !== undefined && { id }), parts: [{ type: 'text', text }] },
  parentId: null,
  sourceId: null,
});

const toolResult = (toolCallId: string): AssistantTransportCommand => ({
  type: 'add-tool-result',
  toolCallId,
  toolName: 'tool',
  result: {},
  isError: false,
});

const texts = (commands: readonly AssistantTransportCommand[]) =>
  commands.map((command) =>
    command.type === 'add-message' ? (command.message.parts[0] as { text: string }).text : '',
  );

const emptySuccessfulResponse = () =>
  new Response(new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }), {
    status: 200,
  });

const createStreamResponse = () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(stream, { status: 200 }),
    push: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    close: () => controller.close(),
  };
};

type StreamResponse = ReturnType<typeof createStreamResponse>;

interface RecordedRequest {
  url: string;
  init: RequestInit;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>;
}

const record = (url: RequestInfo | URL, init: RequestInit = {}): RecordedRequest => ({
  url: String(url),
  init,
  body: JSON.parse(init.body as string),
});

/** A fetch answering each request with a stream the test pushes to and closes. */
const installFetch = () => {
  const requests: RecordedRequest[] = [];
  const servers: StreamResponse[] = [];
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init: RequestInit = {}) => {
    requests.push(record(url, init));
    const server = createStreamResponse();
    servers.push(server);
    return server.response;
  });
  return { requests, servers };
};

/** A fetch whose responses the test settles; aborting the request rejects it. */
const installPendingFetch = () => {
  const requests: RecordedRequest[] = [];
  const pending: { resolve: (response: Response) => void; reject: (reason: unknown) => void }[] =
    [];
  vi.stubGlobal('fetch', (url: RequestInfo | URL, init: RequestInit = {}) => {
    requests.push(record(url, init));
    return new Promise<Response>((resolve, reject) => {
      pending.push({ resolve, reject });
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
  });
  return { requests, pending };
};

/** A fetch answering every request with `respond(url)`, recording each one. */
const recordRequests = (respond: (url: string) => Response = () => emptySuccessfulResponse()) => {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init: RequestInit = {}) => {
    requests.push(record(url, init));
    return respond(String(url));
  });
  return requests;
};

const injectorWith = (...providers: Provider[]) =>
  createEnvironmentInjector(providers, TestBed.inject(EnvironmentInjector));

const mountRuntime = <T = unknown>(options: Partial<AssistantTransportOptions<T>> = {}) => {
  const injector = injectorWith(
    provideAssistantTransportRuntime<T>({
      initialState: {} as T,
      api: API,
      headers: {},
      converter: converter as AssistantTransportStateConverter<T>,
      ...options,
    }),
  );
  const assistant = injector.runInContext(() => injectAssistant());
  const sendCommand = injector.runInContext(() => injectAssistantTransportSendCommand());
  return { assistant: () => assistant, sendCommand, injector };
};

const extrasOf = (assistant: () => AssistantRuntime) =>
  assistant().thread.getState().extras as
    { sendCommand?: (command: AssistantTransportCommand) => void; state?: unknown } | undefined;

const ready = (assistant: () => AssistantRuntime) =>
  waitFor(() => expect(extrasOf(assistant)?.sendCommand).toBeTypeOf('function'));

const agentState = (assistant: () => AssistantRuntime) => extrasOf(assistant)?.state;

const toolCallMessage = (): ThreadMessage => ({
  id: 'a1',
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'probe', args: {}, argsText: '{}' }],
  createdAt: new Date(0),
  status: { type: 'requires-action', reason: 'tool-calls' },
  metadata: {
    unstable_state: {},
    unstable_annotations: [],
    unstable_data: [],
    steps: [],
    custom: {},
  },
});

const toolCallPart = (assistant: () => AssistantRuntime) =>
  assistant().thread.getMessageById('a1').getMessagePartByToolCallId('tc1');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('provideAssistantTransportRuntime', () => {
  it('accepts explicit undefined checkpoint availability', async () => {
    const { assistant } = mountRuntime({ canResume: undefined });
    await waitFor(() => expect(assistant().thread.getState().canResume).toBe(false));
  });

  it.each([
    { resumeApi: RESUME_API, canResume: false, expected: false },
    { canResume: true, expected: false },
    { resumeApi: RESUME_API, canResume: true, expected: true },
  ])(
    'exposes an explicitly known checkpoint only with a resume endpoint: %j',
    async ({ expected, ...options }) => {
      const { assistant } = mountRuntime(options);
      await waitFor(() => expect(assistant().thread.getState().canResume).toBe(expected));
    },
  );

  it('follows a canResume signal', async () => {
    const canResume = signal(false);
    const { assistant } = mountRuntime({ resumeApi: RESUME_API, canResume });
    await ready(assistant);
    expect(assistant().thread.getState().canResume).toBe(false);

    canResume.set(true);
    TestBed.tick();
    await waitFor(() => expect(assistant().thread.getState().canResume).toBe(true));
  });

  it('withholds a known checkpoint while its resume request is running', async () => {
    const fetchMock = installFetch();
    const { assistant } = mountRuntime({ resumeApi: RESUME_API, canResume: true });
    await waitFor(() => expect(assistant().thread.getState().canResume).toBe(true));

    void assistant().thread.resumeRun({ parentId: null });
    await waitFor(() => expect(fetchMock.requests).toHaveLength(1));
    expect(fetchMock.requests[0]?.url).toBe(RESUME_API);
    expect(fetchMock.requests[0]?.body['commands']).toEqual([]);
    await waitFor(() => expect(assistant().thread.getState().canResume).toBe(false));

    fetchMock.servers[0]!.close();
    await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
    expect(assistant().thread.getState().canResume).toBe(true);
  });

  it.each([
    {
      name: 'line',
      protocol: 'assistant-transport' as const,
      response: 'data: [DONE]\n\n',
      limits: { maxStreamLineLength: 5 },
      expectedError: 'maxLineLength',
    },
    {
      name: 'event',
      protocol: 'assistant-transport' as const,
      response: 'data: a\ndata: b\n\n',
      limits: { maxStreamLineLength: 7, maxStreamEventLength: 2 },
      expectedError: 'maxEventLength',
    },
    {
      name: 'data-stream line',
      protocol: 'data-stream' as const,
      response: '0:"hello"\n',
      limits: { maxStreamLineLength: 4 },
      expectedError: 'maxLineLength',
    },
  ])('forwards the configured $name limit', async (testCase) => {
    const onError = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(testCase.response)));
    const { assistant, sendCommand } = mountRuntime({
      protocol: testCase.protocol,
      ...testCase.limits,
      onError,
    });
    await ready(assistant);

    sendCommand(createMessageCommand('hello'));

    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining(testCase.expectedError) }),
        expect.anything(),
      ),
    );
  });

  it.each([false, 0, '', null])('preserves the falsy tool artifact %j', async (artifact) => {
    const fetchMock = installFetch();
    const { assistant } = mountRuntime({
      converter: (_state, meta) => ({ messages: [toolCallMessage()], isRunning: meta.isSending }),
    });
    await waitFor(() => expect(toolCallPart(assistant).getState().type).toBe('tool-call'));

    toolCallPart(assistant).addToolResult(new ToolResponse({ result: 'ok', artifact }));

    await waitFor(() => expect(fetchMock.requests).toHaveLength(1));
    expect(fetchMock.requests[0]!.body['commands'][0]).toHaveProperty('artifact', artifact);

    fetchMock.servers[0]!.close();
    await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
  });

  it("forwards a tool response's modelContent to the outbound command", async () => {
    const fetchMock = installFetch();
    const { assistant } = mountRuntime({
      converter: (_state, meta) => ({ messages: [toolCallMessage()], isRunning: meta.isSending }),
    });
    await waitFor(() => expect(toolCallPart(assistant).getState().type).toBe('tool-call'));

    const modelContent = [{ type: 'text' as const, text: 'done' }];
    toolCallPart(assistant).addToolResult(new ToolResponse({ result: 'ok', modelContent }));

    await waitFor(() => expect(fetchMock.requests).toHaveLength(1));
    expect(fetchMock.requests[0]!.body['commands'][0]).toHaveProperty('modelContent', modelContent);

    fetchMock.servers[0]!.close();
    await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
  });

  it.each(['throws', 'rejects'] as const)(
    'cancels the response body when onResponse %s',
    async (failureMode) => {
      const callbackError = new Error('response callback failed');
      const cancel = vi.fn().mockRejectedValue(new Error('cancel failed'));
      const onError = vi.fn();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))),
      );
      const { assistant, sendCommand } = mountRuntime({
        onResponse: () => {
          if (failureMode === 'throws') throw callbackError;
          return Promise.reject(callbackError);
        },
        onError,
      });
      await ready(assistant);

      sendCommand(createMessageCommand('hello'));

      await waitFor(() => expect(onError).toHaveBeenCalledWith(callbackError, expect.anything()));
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it.each(['headers', 'body', 'prepare'] as const)(
    'settles cancellation while resolving request %s',
    async (phase) => {
      const pending = vi.fn(() => new Promise<never>(() => undefined));
      const fetchMock = vi.fn();
      const onCancel = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const pendingOption: Partial<AssistantTransportOptions<unknown>> =
        phase === 'headers'
          ? { headers: pending }
          : phase === 'body'
            ? { body: pending }
            : { prepareSendCommandsRequest: pending };
      const { assistant, sendCommand } = mountRuntime({ ...pendingOption, onCancel });
      await ready(assistant);

      sendCommand(createMessageCommand('hello'));
      await waitFor(() => expect(pending).toHaveBeenCalledOnce());
      await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(true));

      assistant().thread.cancelRun();

      await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledOnce();
    },
  );

  it('settles cancellation while the response callback is pending', async () => {
    const cancel = vi.fn();
    const onResponse = vi.fn(() => new Promise<void>(() => undefined));
    const onCancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
    const { assistant, sendCommand } = mountRuntime({ onResponse, onCancel });
    await ready(assistant);

    sendCommand(createMessageCommand('hello'));
    await waitFor(() => expect(onResponse).toHaveBeenCalledOnce());

    assistant().thread.cancelRun();

    await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
    expect(cancel).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(texts(onCancel.mock.calls[0]![0].commands)).toEqual(['hello']);
  });

  it('no-ops a follow-up run that finds an empty queue', async () => {
    const fetchMock = installFetch();
    const onError = vi.fn();
    const { assistant, sendCommand } = mountRuntime({ onError });
    await ready(assistant);

    // Two synchronous sends coalesce into one request plus one follow-up run.
    sendCommand(createMessageCommand('a'));
    sendCommand(createMessageCommand('b'));

    await waitFor(() => expect(fetchMock.requests).toHaveLength(1));
    expect(fetchMock.requests[0]!.body['commands'].map((c: { type: string }) => c.type)).toEqual([
      'add-message',
      'add-message',
    ]);
    expect(fetchMock.requests[0]!.body['state']).toEqual({});

    fetchMock.servers[0]!.close();

    await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
    await nextTask();
    expect(onError).not.toHaveBeenCalled();
    expect(fetchMock.requests).toHaveLength(1);
  });

  it('cancels the commands queued behind a run whose response already finished', async () => {
    const fetchMock = installFetch();
    let releaseResponse!: () => void;
    const responseHeld = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const onResponse = vi.fn(() => responseHeld);
    const onCancel = vi.fn();
    let pendingCommands: readonly AssistantTransportCommand[] = [];
    const { assistant, sendCommand } = mountRuntime({
      onResponse,
      onCancel,
      converter: (_state, meta) => {
        pendingCommands = meta.pendingCommands;
        return { messages: [], isRunning: meta.isSending };
      },
    });
    await ready(assistant);

    sendCommand(createMessageCommand('a'));
    await waitFor(() => expect(onResponse).toHaveBeenCalledTimes(1));
    fetchMock.servers[0]!.close();
    sendCommand(createMessageCommand('b'));
    assistant().thread.cancelRun();
    releaseResponse();

    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(texts(onCancel.mock.calls[0]![0].commands)).toEqual(['a', 'b']);
    await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
    expect(pendingCommands).toEqual([]);
    expect(fetchMock.requests).toHaveLength(1);
  });

  it('skips add-message commands with no supported parts', async () => {
    const fetchMock = installFetch();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { assistant, sendCommand } = mountRuntime();
    await ready(assistant);

    void assistant().thread.append({
      role: 'user',
      content: [{ type: 'audio', audio: { data: '', format: 'mp3' } }],
    });

    await nextTask();
    expect(warn).toHaveBeenCalledWith(
      '[ngx-assistant] Skipped add-message command with no supported parts',
    );
    expect(fetchMock.requests).toHaveLength(0);

    // The skipped message must not leak its parentId into later batches.
    sendCommand(createMessageCommand('follow-up'));
    await waitFor(() => expect(fetchMock.requests).toHaveLength(1));
    expect(fetchMock.requests[0]!.body).not.toHaveProperty('parentId');
  });

  it('flushes commands enqueued during a resume run in a follow-up run', async () => {
    const fetchMock = installFetch();
    const { assistant, sendCommand } = mountRuntime({ resumeApi: RESUME_API });
    await ready(assistant);

    sendCommand(createMessageCommand('a'));
    await waitFor(() => expect(fetchMock.requests).toHaveLength(1));

    // Both land while the first run is active and coalesce into one follow-up.
    sendCommand(createMessageCommand('b'));
    void assistant().thread.resumeRun({ parentId: null });

    fetchMock.servers[0]!.close();
    await waitFor(() => expect(fetchMock.requests).toHaveLength(2));
    expect(fetchMock.requests[1]!.url).toBe(RESUME_API);
    expect(fetchMock.requests[1]!.body['commands']).toEqual([]);
    expect(fetchMock.requests[1]!.body).toHaveProperty('state');

    // "b" coalesced into the resume run and must not starve in the queue.
    fetchMock.servers[1]!.close();
    await waitFor(() => expect(fetchMock.requests).toHaveLength(3));
    expect(fetchMock.requests[2]!.url).toBe(API);
    expect(fetchMock.requests[2]!.body['commands']).toMatchObject([createMessageCommand('b')]);
    expect(fetchMock.requests[2]!.body['commands'][0].message.id).toEqual(expect.any(String));

    fetchMock.servers[2]!.close();
    await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
  });

  it.each(['error', 'cancellation'] as const)(
    'does not apply a dropped resume after run %s',
    async (settlement) => {
      const fetchMock = installPendingFetch();
      const onError = vi.fn();
      const { assistant, sendCommand } = mountRuntime({ resumeApi: RESUME_API, onError });
      await ready(assistant);

      sendCommand(createMessageCommand('a'));
      await waitFor(() => expect(fetchMock.requests).toHaveLength(1));

      await assistant().thread.resumeRun({ parentId: null });
      if (settlement === 'cancellation') {
        assistant().thread.cancelRun();
      } else {
        fetchMock.pending[0]!.reject(new Error('request failed'));
      }
      await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));

      sendCommand(createMessageCommand('b'));
      await waitFor(() => expect(fetchMock.requests).toHaveLength(2));
      expect(fetchMock.requests[1]!.url).toBe(API);
      expect(fetchMock.requests[1]!.body['commands']).toMatchObject([createMessageCommand('b')]);
      expect(fetchMock.requests[1]!.body['commands'][0].message.id).toEqual(expect.any(String));

      fetchMock.pending[1]!.resolve(new Response('', { status: 200 }));
      await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
      expect(onError).toHaveBeenCalledTimes(settlement === 'error' ? 1 : 0);
    },
  );

  describe('commands sent around cancelRun', () => {
    it('sends a command issued right after cancelRun in a follow-up run', async () => {
      const fetchMock = installPendingFetch();
      const onCancel = vi.fn();
      const { assistant, sendCommand } = mountRuntime({ onCancel });
      await ready(assistant);

      sendCommand(createMessageCommand('a'));
      await waitFor(() => expect(fetchMock.requests).toHaveLength(1));
      assistant().thread.cancelRun();
      sendCommand(createMessageCommand('b'));

      await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
      expect(texts(onCancel.mock.calls[0]![0].commands)).toEqual(['a']);
      await waitFor(() => expect(fetchMock.requests).toHaveLength(2));
      expect(texts(fetchMock.requests[1]!.body['commands'])).toEqual(['b']);
    });

    it('sends a command issued after cancelRun before the cancelled run started', async () => {
      const fetchMock = installPendingFetch();
      const onCancel = vi.fn();
      const { assistant, sendCommand } = mountRuntime({ onCancel });
      await ready(assistant);

      sendCommand(createMessageCommand('a'));
      assistant().thread.cancelRun();
      sendCommand(createMessageCommand('b'));

      await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
      expect(texts(onCancel.mock.calls[0]![0].commands)).toEqual(['a']);
      await waitFor(() => expect(fetchMock.requests).toHaveLength(1));
      expect(texts(fetchMock.requests[0]!.body['commands'])).toEqual(['b']);
    });

    it('does not report an empty cancellation after a stop during onError', async () => {
      installFetch();
      let releaseOnError!: () => void;
      const onErrorHeld = new Promise<void>((resolve) => {
        releaseOnError = resolve;
      });
      const onError = vi.fn(() => onErrorHeld);
      const onCancel = vi.fn();
      const { assistant, sendCommand } = mountRuntime({
        onError,
        onCancel,
        onResponse: () => {
          throw new Error('boom');
        },
      });
      await ready(assistant);

      sendCommand(createMessageCommand('a'));
      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      assistant().thread.cancelRun();
      releaseOnError();
      await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
      await nextTask();

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onCancel.mock.calls[0]![0]).toMatchObject({
        commands: [],
        error: expect.objectContaining({ message: 'boom' }),
      });
    });

    it('reports a command cancelled while onError runs exactly once', async () => {
      const fetchMock = installFetch();
      let releaseOnError!: () => void;
      const onErrorHeld = new Promise<void>((resolve) => {
        releaseOnError = resolve;
      });
      const onError = vi.fn(() => onErrorHeld);
      const onCancel = vi.fn();
      let pendingCommands: readonly AssistantTransportCommand[] = [];
      const { assistant, sendCommand } = mountRuntime({
        onError,
        onCancel,
        onResponse: () => {
          throw new Error('boom');
        },
        converter: (_state, meta) => {
          pendingCommands = meta.pendingCommands;
          return { messages: [], isRunning: meta.isSending };
        },
      });
      await ready(assistant);

      sendCommand(createMessageCommand('a'));
      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      sendCommand(createMessageCommand('b'));
      assistant().thread.cancelRun();
      releaseOnError();

      await waitFor(() =>
        expect(onCancel.mock.calls.flatMap(([payload]) => texts(payload.commands))).toEqual(['b']),
      );
      await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
      expect(onCancel).toHaveBeenCalledTimes(2);
      expect(onCancel.mock.calls.filter(([payload]) => !payload.error)).toHaveLength(1);
      expect(pendingCommands).toEqual([]);
      expect(fetchMock.requests).toHaveLength(1);
    });

    const setReply = (value: string) =>
      `aui-state:[{"type":"set","path":["reply"],"value":"${value}"}]\n`;

    // installFetch's body ignores the abort signal, like a body that has fully arrived, which
    // abort() can no longer error.
    it('drops a reply read after cancelRun and reports its command cancelled', async () => {
      const fetchMock = installFetch();
      const onCancel = vi.fn();
      const { assistant, sendCommand } = mountRuntime({ onCancel });
      await ready(assistant);

      sendCommand(createMessageCommand('a'));
      await waitFor(() => expect(fetchMock.requests).toHaveLength(1));
      await nextTask();
      assistant().thread.cancelRun();
      fetchMock.servers[0]!.push(setReply('late'));
      fetchMock.servers[0]!.close();

      await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
      expect(texts(onCancel.mock.calls[0]![0].commands)).toEqual(['a']);
      expect(agentState(assistant)).toEqual({});
    });

    it('keeps the snapshot committed before cancelRun and ignores later ones', async () => {
      const fetchMock = installFetch();
      const onCancel = vi.fn();
      const { assistant, sendCommand } = mountRuntime({ onCancel });
      await ready(assistant);

      sendCommand(createMessageCommand('a'));
      await waitFor(() => expect(fetchMock.requests).toHaveLength(1));
      fetchMock.servers[0]!.push(setReply('early'));
      await waitFor(() => expect(agentState(assistant)).toEqual({ reply: 'early' }));
      assistant().thread.cancelRun();
      fetchMock.servers[0]!.push(setReply('late'));
      fetchMock.servers[0]!.close();

      await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
      expect(onCancel.mock.calls[0]![0].commands).toEqual([]);
      expect(agentState(assistant)).toEqual({ reply: 'early' });
    });
  });

  describe('resume', () => {
    const resumeFetch = (resumeState: () => Response, resume = () => emptySuccessfulResponse()) =>
      recordRequests((url) => (url === RESUME_STATE_API ? resumeState() : resume()));

    it('applies resumed operations to the retained initial state', async () => {
      const requests = resumeFetch(
        () => Response.json({ runId: 'run-1', state: { message: 'Hello' } }),
        () =>
          new Response('aui-state:[{"type":"append-text","path":["message"],"value":" world"}]\n', {
            status: 200,
          }),
      );
      const { assistant } = mountRuntime({
        resumeApi: RESUME_API,
        resumeStateApi: RESUME_STATE_API,
      });
      await ready(assistant);

      assistant().thread.importExternalState({ message: 'Wrong' });
      await assistant().thread.resumeRun({ parentId: null });

      await waitFor(() => expect(agentState(assistant)).toEqual({ message: 'Hello world' }));
      expect(requests.map((request) => request.url)).toEqual([RESUME_STATE_API, RESUME_API]);
      expect(requests[1]!.body).toMatchObject({ runId: 'run-1' });
      expect(requests[1]!.body).not.toHaveProperty('state');
    });

    it('rejects malformed resume state responses before replay', async () => {
      const fetchMock = vi.fn(async () => Response.json({ state: {} }));
      vi.stubGlobal('fetch', fetchMock);
      const onError = vi.fn();
      const { assistant } = mountRuntime({
        resumeApi: RESUME_API,
        resumeStateApi: RESUME_STATE_API,
        onError,
      });
      await ready(assistant);

      await assistant().thread.resumeRun({ parentId: null });

      await waitFor(() =>
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Resume state response must contain state and runId',
          }),
          expect.anything(),
        ),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('commits a retained null state locally and omits state from the resume request', async () => {
      const requests = resumeFetch(() => Response.json({ runId: 'run-1', state: null }));
      const { assistant } = mountRuntime({
        resumeApi: RESUME_API,
        resumeStateApi: RESUME_STATE_API,
      });
      await ready(assistant);

      assistant().thread.importExternalState({ message: 'Wrong' });
      await assistant().thread.resumeRun({ parentId: null });

      await waitFor(() => expect(requests).toHaveLength(2));
      expect(requests[1]!.body).toMatchObject({ runId: 'run-1' });
      expect(requests[1]!.body).not.toHaveProperty('state');
      await waitFor(() => expect(agentState(assistant)).toBeNull());
    });

    it('skips the resume without error when the state endpoint reports no active run', async () => {
      const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
      vi.stubGlobal('fetch', fetchMock);
      const onError = vi.fn();
      const { assistant } = mountRuntime({
        resumeApi: RESUME_API,
        resumeStateApi: RESUME_STATE_API,
        onError,
      });
      await ready(assistant);

      assistant().thread.importExternalState({ message: 'Kept' });
      await assistant().thread.resumeRun({ parentId: null });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
      expect(onError).not.toHaveBeenCalled();
      expect(agentState(assistant)).toEqual({ message: 'Kept' });
    });

    it('keeps the retained runId over body overrides in the resume request', async () => {
      const requests = resumeFetch(() =>
        Response.json({ runId: 'run-1', state: { message: 'Hello' } }),
      );
      const { assistant } = mountRuntime({
        resumeApi: RESUME_API,
        resumeStateApi: RESUME_STATE_API,
        body: { state: { message: 'Injected' }, runId: 'bogus' },
      });
      await ready(assistant);

      await assistant().thread.resumeRun({ parentId: null });

      await waitFor(() => expect(requests).toHaveLength(2));
      expect(requests[1]!.body['runId']).toBe('run-1');
      expect(requests[1]!.body).not.toHaveProperty('state');
    });

    it('re-attaches runId and strips substituted state when prepareSendCommandsRequest rebuilds the body', async () => {
      const requests = resumeFetch(() =>
        Response.json({ runId: 'run-1', state: { message: 'Hello' } }),
      );
      const { assistant } = mountRuntime({
        resumeApi: RESUME_API,
        resumeStateApi: RESUME_STATE_API,
        prepareSendCommandsRequest: (body) => ({
          commands: body.commands,
          state: { message: 'Substituted' },
          rebuilt: true,
        }),
      });
      await ready(assistant);

      await assistant().thread.resumeRun({ parentId: null });

      await waitFor(() => expect(requests).toHaveLength(2));
      expect(requests[1]!.body).toMatchObject({ runId: 'run-1', rebuilt: true });
      expect(requests[1]!.body).not.toHaveProperty('state');
    });

    it('keeps local state when the matching resume stream is rejected', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ runId: 'run-1', state: { message: 'Hello' } }))
        .mockResolvedValueOnce(new Response('run mismatch', { status: 409 }));
      vi.stubGlobal('fetch', fetchMock);
      const onError = vi.fn();
      const { assistant } = mountRuntime({
        resumeApi: RESUME_API,
        resumeStateApi: RESUME_STATE_API,
        onError,
      });
      await ready(assistant);

      assistant().thread.importExternalState({ message: 'Wrong' });
      await assistant().thread.resumeRun({ parentId: null });

      await waitFor(() =>
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({ message: 'Status 409: run mismatch' }),
          expect.anything(),
        ),
      );
      expect(agentState(assistant)).toEqual({ message: 'Wrong' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('fails a resume without resumeApi', async () => {
      const { assistant } = mountRuntime();
      await ready(assistant);

      await expect(assistant().thread.resumeRun({ parentId: null })).rejects.toThrow(
        'Must pass resumeApi to options to resume runs',
      );
    });
  });

  it('ends a failed run on cancelRun while its onError is still pending', async () => {
    const fetchMock = installFetch();
    const onError = vi.fn(() => new Promise<void>(() => undefined));
    const onCancel = vi.fn();
    const onFinish = vi.fn();
    const onResponse = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('boom');
      })
      .mockImplementation(() => undefined);
    const { assistant, sendCommand } = mountRuntime({ onError, onCancel, onFinish, onResponse });
    await ready(assistant);

    sendCommand(createMessageCommand('a'));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    sendCommand(createMessageCommand('b', 'b-id'));
    expect(assistant().thread.getState().isRunning).toBe(true);

    assistant().thread.cancelRun();
    await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel.mock.calls[0]![0].commands).toEqual([createMessageCommand('b', 'b-id')]);

    sendCommand(createMessageCommand('c', 'c-id'));
    await waitFor(() => expect(fetchMock.requests).toHaveLength(2));
    expect(fetchMock.requests[1]!.body['commands']).toEqual([createMessageCommand('c', 'c-id')]);
  });

  it("reports the commands queued before the failure once a cancelled run's onError settles", async () => {
    const fetchMock = installFetch();
    let failResponse!: (error: Error) => void;
    const responseFailed = new Promise<void>((_, reject) => {
      failResponse = reject;
    });
    const onResponse = vi
      .fn()
      .mockImplementationOnce(() => responseFailed)
      .mockImplementation(() => undefined);
    let settleOnError!: () => void;
    const onError = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settleOnError = resolve;
        }),
    );
    const onCancel = vi.fn();
    const { assistant, sendCommand } = mountRuntime({ onError, onCancel, onResponse });
    await ready(assistant);

    sendCommand(createMessageCommand('a'));
    await waitFor(() => expect(onResponse).toHaveBeenCalledTimes(1));
    sendCommand(createMessageCommand('b', 'b-id'));
    const boom = new Error('boom');
    failResponse(boom);
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    sendCommand(createMessageCommand('c', 'c-id'));

    assistant().thread.cancelRun();
    await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel.mock.calls[0]![0]).not.toHaveProperty('error');
    expect(onCancel.mock.calls[0]![0].commands).toEqual([createMessageCommand('c', 'c-id')]);

    sendCommand(createMessageCommand('d', 'd-id'));
    await waitFor(() => expect(fetchMock.requests).toHaveLength(2));

    settleOnError();
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(2));
    expect(onCancel.mock.calls[1]![0].error).toBe(boom);
    expect(onCancel.mock.calls[1]![0].commands).toEqual([createMessageCommand('b', 'b-id')]);
    expect(fetchMock.requests[1]!.body['commands']).toEqual([createMessageCommand('d', 'd-id')]);
    await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(true));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  describe('replay', () => {
    it('shows the thread as loading while replayed bytes stream, then live', async () => {
      const server = createStreamResponse();
      const replayed = 'aui-state:[{"type":"set","path":["reply"],"value":"replayed"}]\n';
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(server.response.body, {
              headers: {
                [REPLAY_CONTENT_LENGTH_HEADER]: String(new TextEncoder().encode(replayed).length),
              },
            }),
        ),
      );
      const { assistant } = mountRuntime({ resumeApi: RESUME_API });
      await ready(assistant);

      void assistant().thread.resumeRun({ parentId: null });
      await waitFor(() => expect(assistant().thread.getState().isLoading).toBe(true));

      server.push(replayed);
      await waitFor(() => expect(assistant().thread.getState().isLoading).toBe(false));
      expect(agentState(assistant)).toEqual({ reply: 'replayed' });

      server.push('aui-state:[{"type":"set","path":["reply"],"value":"live"}]\n');
      server.close();
      await waitFor(() => expect(agentState(assistant)).toEqual({ reply: 'live' }));
      await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
    });

    it('ends a resumed run on cancelRun while its replay is pending', async () => {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            init.signal!.addEventListener('abort', () => controller.error(init.signal!.reason));
          },
        });
        return new Response(stream, { headers: { [REPLAY_CONTENT_LENGTH_HEADER]: '10' } });
      });
      vi.stubGlobal('fetch', fetchMock);
      const onCancel = vi.fn();
      const { assistant } = mountRuntime({ resumeApi: RESUME_API, onCancel });
      await ready(assistant);

      void assistant().thread.resumeRun({ parentId: null });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(assistant().thread.getState().isLoading).toBe(true));
      assistant().thread.cancelRun();

      await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
      expect(assistant().thread.getState().isLoading).toBe(false);
    });
  });
});

describe('assistant transport delivery contracts', () => {
  const setupDelivery = () => {
    const bodies: { commands: { type: string }[] }[] = [];
    vi.stubGlobal('fetch', async (_url: RequestInfo | URL, init: RequestInit = {}) => {
      bodies.push(JSON.parse(init.body as string));
      return emptySuccessfulResponse();
    });
    let pending: AssistantTransportCommand[] = [];
    const { assistant, sendCommand } = mountRuntime({
      converter: (_state, { pendingCommands, isSending }) => {
        pending = pendingCommands;
        return { messages: [], isRunning: isSending };
      },
    });
    return { assistant, sendCommand, bodies, pending: () => pending };
  };

  it('clears in-transit commands when a run succeeds without state chunks', async () => {
    const { assistant, bodies, pending } = setupDelivery();
    await ready(assistant);

    void assistant().thread.append('m1');

    await waitFor(() => expect(bodies).toHaveLength(1));
    await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
    await waitFor(() => expect(pending()).toHaveLength(0));
  });

  it('sends a message appended before a command ahead of it', async () => {
    const { assistant, sendCommand, bodies } = setupDelivery();
    await ready(assistant);

    void assistant().thread.append('m1');
    sendCommand(toolResult('t1'));

    await waitFor(() => expect(bodies.length).toBeGreaterThan(0));
    await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
    const sent = bodies.flatMap((body) => body.commands);
    expect(sent.map((command) => command.type)).toEqual(['add-message', 'add-tool-result']);
  });
});

describe('assistant transport parentId lifetime', () => {
  it("consumes parentId per run: the append's run carries it, a later sendCommand run omits it", async () => {
    const requests = recordRequests();
    const { assistant, sendCommand } = mountRuntime();
    await ready(assistant);

    void assistant().thread.append('m1');

    await waitFor(() => expect(requests).toHaveLength(1));
    await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
    expect(Object.hasOwn(requests[0]!.body, 'parentId')).toBe(true);

    sendCommand(toolResult('t1'));

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(Object.hasOwn(requests[1]!.body, 'parentId')).toBe(false);
  });

  it.each(['cancel', 'error'] as const)(
    "drops the parentId of a message discarded by a run's %s",
    async (outcome) => {
      const requests: RecordedRequest[] = [];
      let settleFirstRun!: () => void;
      vi.stubGlobal('fetch', (url: RequestInfo | URL, init: RequestInit = {}) => {
        requests.push(record(url, init));
        if (requests.length > 1) return Promise.resolve(emptySuccessfulResponse());
        return new Promise<Response>((_resolve, reject) => {
          settleFirstRun = () => reject(new Error('network down'));
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason), {
            once: true,
          });
        });
      });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { assistant, sendCommand } = mountRuntime();
      await ready(assistant);

      sendCommand(toolResult('t0'));
      await waitFor(() => expect(requests).toHaveLength(1));
      void assistant().thread.append('m2');
      await nextTask();
      if (outcome === 'cancel') assistant().thread.cancelRun();
      else settleFirstRun();
      await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));

      sendCommand(toolResult('t1'));

      await waitFor(() => expect(requests).toHaveLength(2));
      expect(requests[1]!.body['commands']).toEqual([toolResult('t1')]);
      expect(Object.hasOwn(requests[1]!.body, 'parentId')).toBe(false);
    },
  );
});

describe('assistant transport user message ids', () => {
  interface State {
    messages: { id?: string; role: 'user' | 'assistant'; text: string }[];
  }

  const user = (id: string, text: string): ThreadMessage => ({
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    attachments: [],
    createdAt: new Date(0),
    metadata: { custom: {} },
  });

  const assistantMessage = (id: string, text: string): ThreadMessage => ({
    id,
    role: 'assistant',
    content: [{ type: 'text', text }],
    status: { type: 'complete', reason: 'stop' },
    createdAt: new Date(0),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  });

  const messagesConverter: AssistantTransportStateConverter<State> = (state, meta) => ({
    messages: [
      ...state.messages.map((message, index) =>
        message.role === 'user'
          ? user(message.id ?? `__external_store_fallback_${index}`, message.text)
          : assistantMessage(message.id!, message.text),
      ),
      ...meta.pendingCommands.flatMap((command) =>
        command.type === 'add-message' && command.message.role === 'user'
          ? [
              user(
                command.message.id ?? 'missing-client-id',
                command.message.parts
                  .flatMap((part) => (part.type === 'text' ? [part.text] : []))
                  .join(' '),
              ),
            ]
          : [],
      ),
    ],
    isRunning: meta.isSending,
  });

  const command = (id?: string): AssistantTransportCommand => ({
    type: 'add-message',
    message: {
      role: 'user',
      ...(id !== undefined && { id }),
      parts: [{ type: 'text', text: 'hello' }],
    },
    parentId: null,
    sourceId: null,
  });

  const setupIds = async () => {
    let resolveResponse!: (response: Response) => void;
    const requests: { commands: AssistantTransportCommand[] }[] = [];
    vi.stubGlobal('fetch', (_url: RequestInfo | URL, init: RequestInit) => {
      requests.push(JSON.parse(init.body as string));
      return new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      });
    });
    const { assistant, sendCommand } = mountRuntime<State>({
      initialState: { messages: [] },
      protocol: 'assistant-transport',
      converter: messagesConverter,
    });

    const settle = async (messages: State['messages']) => {
      const chunks = [
        {
          type: 'update-state',
          operations: [{ type: 'set', path: ['messages'], value: messages }],
        },
        '[DONE]',
      ];
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(
              encoder.encode(
                `data: ${typeof chunk === 'string' ? chunk : JSON.stringify(chunk)}\n\n`,
              ),
            );
          }
          controller.close();
        },
      });
      resolveResponse(new Response(stream, { status: 200 }));
      await waitFor(() => expect(assistant().thread.getState().isRunning).toBe(false));
    };

    await ready(assistant);
    return { assistant, requests, settle, send: sendCommand };
  };

  const sentUserId = (sent: AssistantTransportCommand) => {
    if (sent.type !== 'add-message' || sent.message.role !== 'user') {
      throw new Error('Expected user command');
    }
    return sent.message.id!;
  };

  it('sends an appended user message with a generated id', async () => {
    const app = await setupIds();
    void app.assistant().thread.append('hello');
    await waitFor(() => expect(app.requests).toHaveLength(1));
    expect(sentUserId(app.requests[0]!.commands[0]!)).toEqual(expect.any(String));
    await app.settle([]);
  });

  it('replaces an optimistic user message in place when the backend preserves its id', async () => {
    const app = await setupIds();
    app.send(command());
    await waitFor(() => expect(app.requests).toHaveLength(1));
    const id = sentUserId(app.requests[0]!.commands[0]!);
    await waitFor(() =>
      expect(app.assistant().thread.getState().messages[0]?.metadata.isOptimistic).toBe(true),
    );
    expect(app.assistant().thread.getState().messages[0]?.id).toBe(id);

    await app.settle([
      { id, role: 'user', text: 'hello' },
      { id: 'answer', role: 'assistant', text: 'hi' },
    ]);
    await waitFor(() =>
      expect(
        app
          .assistant()
          .thread.getState()
          .messages.map((message) => message.id),
      ).toEqual([id, 'answer']),
    );
    expect(app.assistant().thread.getState().messages[0]?.metadata.isOptimistic).not.toBe(true);
    expect(app.assistant().thread.getMessageById(id).getState().branchCount).toBe(1);
  });

  it('evicts a pending message when the backend omits its id', async () => {
    const app = await setupIds();
    app.send(command());
    await waitFor(() => expect(app.requests).toHaveLength(1));
    const id = sentUserId(app.requests[0]!.commands[0]!);

    await app.settle([
      { role: 'user', text: 'hello' },
      { id: 'answer', role: 'assistant', text: 'hi' },
    ]);
    await waitFor(() =>
      expect(
        app
          .assistant()
          .thread.getState()
          .messages.map((message) => message.id),
      ).toEqual(['__external_store_fallback_0', 'answer']),
    );
    const messages = app.assistant().thread.getState().messages;
    expect(messages.some((message) => message.id === id)).toBe(false);
    expect(app.assistant().thread.getMessageById(messages[0]!.id).getState().branchCount).toBe(1);
  });

  it.each([undefined, 'caller-id'])('sends a user command with id %s', async (id) => {
    const app = await setupIds();
    app.send(command(id));
    await waitFor(() => expect(app.requests).toHaveLength(1));
    const sent = sentUserId(app.requests[0]!.commands[0]!);
    if (id !== undefined) expect(sent).toBe(id);
    else expect(sent).toEqual(expect.any(String));
    expect(sent).not.toBe('');
    await waitFor(() =>
      expect(app.assistant().thread.getState().messages[0]?.metadata.isOptimistic).toBe(true),
    );
    await app.settle([]);
  });
});
