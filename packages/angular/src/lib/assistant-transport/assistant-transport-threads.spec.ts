import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  InjectionToken,
  type Provider,
  createEnvironmentInjector,
  inject,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  AssistantRuntime,
  ChatModelAdapter,
  RemoteThreadListAdapter,
  ThreadMessage,
} from '@ngx-assistant/engine';
import { provideLocalRuntime } from '../local-runtime';
import { provideRemoteThreadListRuntime } from '../remote-thread-list';
import { NXA_REMOTE_THREAD_ITEM, provideRuntimeAdapters } from '../runtime-adapters';
import { injectAssistant } from '../scopes';
import { provideAssistantTransportRuntime } from './assistant-transport-runtime';
import {
  injectAssistantTransportSendCommand,
  injectAssistantTransportState,
} from './transport-state';
import type {
  AssistantTransportCommand,
  AssistantTransportOptions,
  AssistantTransportStateConverter,
} from './types';

const API = 'http://localhost/api';
const RESUME_API = 'http://localhost/resume';
const RESUME_STATE_API = 'http://localhost/resume-state';

const waitFor = (assertion: () => void) => vi.waitFor(assertion, { interval: 10 });
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const converter: AssistantTransportStateConverter<unknown> = (_state, meta) => ({
  messages: [],
  isRunning: meta.isSending,
});

// Shows queued messages, so an append made during a run gets a parent.
const pendingMessagesConverter: AssistantTransportStateConverter<unknown> = (_state, meta) => ({
  messages: meta.pendingCommands.flatMap((command, index) =>
    command.type === 'add-message'
      ? [
          {
            id: `pending-${index}`,
            role: 'user' as const,
            content: command.message.parts,
            attachments: [],
            createdAt: new Date(0),
            metadata: { custom: {} },
          } as ThreadMessage,
        ]
      : [],
  ),
  isRunning: meta.isSending,
});

interface ChatState {
  messages?: { id: string; role: 'user' | 'assistant'; text: string }[];
}

// Draws the messages the backend put in the state.
const messagesConverter: AssistantTransportStateConverter<ChatState> = (state, meta) => ({
  messages: (state.messages ?? []).map((message): ThreadMessage =>
    message.role === 'user'
      ? {
          id: message.id,
          role: 'user',
          content: [{ type: 'text', text: message.text }],
          attachments: [],
          createdAt: new Date(0),
          metadata: { custom: {} },
        }
      : {
          id: message.id,
          role: 'assistant',
          content: [{ type: 'text', text: message.text }],
          status: { type: 'complete', reason: 'stop' },
          createdAt: new Date(0),
          metadata: {
            unstable_state: null,
            unstable_annotations: [],
            unstable_data: [],
            steps: [],
            custom: {},
          },
        },
  ),
  isRunning: meta.isSending,
});

interface RecordedRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

const emptySuccessfulResponse = () =>
  new Response(new ReadableStream({ start: (controller) => controller.close() }), { status: 200 });

const recordRequests = (respond?: (url: string) => Response | undefined) => {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal('fetch', async (url: RequestInfo | URL, init: RequestInit = {}) => {
    requests.push({
      url: String(url),
      headers: new Headers(init.headers),
      body: JSON.parse(init.body as string),
    });
    return respond?.(String(url)) ?? emptySuccessfulResponse();
  });
  return requests;
};

/** An adapter over an empty list whose methods are spies. */
const makeAdapter = (
  overrides: Partial<RemoteThreadListAdapter> = {},
): RemoteThreadListAdapter => ({
  list: vi.fn(async () => ({ threads: [] })),
  initialize: vi.fn(async (threadId: string) => ({ remoteId: threadId, externalId: threadId })),
  rename: vi.fn(async () => undefined),
  archive: vi.fn(async () => undefined),
  unarchive: vi.fn(async () => undefined),
  delete: vi.fn(async () => undefined),
  generateTitle: vi.fn(
    async () => new ReadableStream({ start: (controller) => controller.close() }) as never,
  ),
  fetch: vi.fn(async (id: string) => ({
    status: 'regular' as const,
    remoteId: id,
    externalId: id,
  })),
  ...overrides,
});

const injectorWith = (...providers: Provider[]) =>
  createEnvironmentInjector(providers, TestBed.inject(EnvironmentInjector));

const transportOptions = <T>(
  options: Partial<AssistantTransportOptions<T>> = {},
): AssistantTransportOptions<T> => ({
  initialState: {} as T,
  api: API,
  headers: {},
  converter: converter as AssistantTransportStateConverter<T>,
  ...options,
});

const ready = (assistant: AssistantRuntime) =>
  waitFor(() =>
    expect(
      (assistant.thread.getState().extras as { sendCommand?: unknown })?.sendCommand,
    ).toBeTypeOf('function'),
  );

const render = async (...providers: Provider[]) => {
  const injector = injectorWith(...providers);
  const assistant = injector.runInContext(() => injectAssistant());
  await ready(assistant);
  return { assistant, injector };
};

const renderInThreadList = async (
  adapter: RemoteThreadListAdapter,
  options: Partial<AssistantTransportOptions<unknown>> = {},
) =>
  (
    await render(
      provideRemoteThreadListRuntime({
        adapter,
        runtime: () => provideAssistantTransportRuntime(transportOptions(options)),
      }),
    )
  ).assistant;

const deferredInitialization = () => {
  const initialization = deferred<{ remoteId: string; externalId: string | undefined }>();
  const adapter = makeAdapter({ initialize: vi.fn(() => initialization.promise) });
  return { adapter, initialization };
};

const sendCommandOf = (assistant: AssistantRuntime) =>
  (
    assistant.thread.getState().extras as {
      sendCommand: (command: AssistantTransportCommand) => void;
    }
  ).sendCommand;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('assistant transport thread id', () => {
  it("waits for a new thread's initialization and posts its remote id", async () => {
    const { adapter, initialization } = deferredInitialization();
    const requests = recordRequests();
    const assistant = await renderInThreadList(adapter);

    void assistant.thread.append('hello');
    await waitFor(() => expect(adapter.initialize).toHaveBeenCalledOnce());
    await nextTask();
    expect(requests).toHaveLength(0);

    initialization.resolve({ remoteId: 'remote-1', externalId: undefined });

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.body['threadId']).toBe('remote-1');
  });

  it("keeps each run's parentId when a message is appended while the thread initializes", async () => {
    const { adapter, initialization } = deferredInitialization();
    const requests = recordRequests();
    const assistant = await renderInThreadList(adapter, { converter: pendingMessagesConverter });

    void assistant.thread.append('first');
    await waitFor(() => expect(assistant.thread.getState().messages).not.toHaveLength(0));
    const secondParentId = assistant.thread.getState().messages.at(-1)!.id;
    void assistant.thread.append('second');
    initialization.resolve({ remoteId: 'remote-1', externalId: undefined });

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.map((request) => request.body['parentId'])).toEqual([null, secondParentId]);
  });

  it('resumes a thread that was never initialized without creating it', async () => {
    const adapter = makeAdapter();
    const requests = recordRequests(() => new Response(null, { status: 204 }));
    const assistant = await renderInThreadList(adapter, {
      resumeApi: RESUME_API,
      resumeStateApi: RESUME_STATE_API,
    });

    void assistant.thread.resumeRun({ parentId: null });

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ url: RESUME_STATE_API, body: {} });
    expect(adapter.initialize).not.toHaveBeenCalled();
  });

  it('resumes an initialized thread with its remote id', async () => {
    const adapter = makeAdapter();
    const requests = recordRequests((url) =>
      url === RESUME_STATE_API ? new Response(null, { status: 204 }) : undefined,
    );
    const assistant = await renderInThreadList(adapter, {
      resumeApi: RESUME_API,
      resumeStateApi: RESUME_STATE_API,
    });

    void assistant.thread.append('hello');
    await waitFor(() => expect(requests).toHaveLength(1));
    await waitFor(() => expect(assistant.thread.getState().isRunning).toBe(false));
    void assistant.thread.resumeRun({ parentId: null });

    await waitFor(() => expect(requests).toHaveLength(2));
    const threadId = requests[0]!.body['threadId'];
    expect(threadId).toEqual(expect.any(String));
    expect(requests[1]).toMatchObject({ url: RESUME_STATE_API, body: { threadId } });
    expect(adapter.initialize).toHaveBeenCalledOnce();
  });

  it('sends nothing and hands the batch to onError when initialization fails', async () => {
    const adapter = makeAdapter({
      initialize: vi.fn(async () => {
        throw new Error('initialize failed');
      }),
    });
    const requests = recordRequests();
    const onError = vi.fn();
    const assistant = await renderInThreadList(adapter, { onError });

    void assistant.thread.append('hello');

    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError).toHaveBeenCalledWith(
      new Error('initialize failed'),
      expect.objectContaining({ commands: [expect.objectContaining({ type: 'add-message' })] }),
    );
    expect(requests).toHaveLength(0);
  });

  it('releases a run cancelled while its thread initializes', async () => {
    const { adapter, initialization } = deferredInitialization();
    const requests = recordRequests();
    const onCancel = vi.fn();
    const assistant = await renderInThreadList(adapter, { onCancel });

    void assistant.thread.append('first');
    await waitFor(() => expect(assistant.thread.getState().isRunning).toBe(true));
    assistant.thread.cancelRun();
    await waitFor(() => expect(assistant.thread.getState().isRunning).toBe(false));
    expect(onCancel).toHaveBeenCalledWith(
      expect.objectContaining({ commands: [expect.objectContaining({ type: 'add-message' })] }),
    );

    void assistant.thread.append('second');
    initialization.resolve({ remoteId: 'remote-1', externalId: undefined });

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.body).toMatchObject({
      threadId: 'remote-1',
      commands: [{ message: { parts: [{ text: 'second' }] } }],
    });
  });

  it('creates no thread for a run cancelled before it starts', async () => {
    const adapter = makeAdapter({
      initialize: vi.fn(async () => {
        throw new Error('initialize failed');
      }),
    });
    const requests = recordRequests();
    const assistant = await renderInThreadList(adapter);

    sendCommandOf(assistant)({ type: 'start-session' } as unknown as AssistantTransportCommand);
    assistant.thread.cancelRun();

    await waitFor(() => expect(assistant.thread.getState().isRunning).toBe(false));
    await nextTask();
    expect(adapter.initialize).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it('titles a thread whose first run is a custom command', async () => {
    const generateTitle = vi.fn<RemoteThreadListAdapter['generateTitle']>(
      async () => new ReadableStream() as never,
    );
    const adapter = makeAdapter({ generateTitle });
    vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined));
    const assistant = await renderInThreadList(adapter, { converter: pendingMessagesConverter });

    sendCommandOf(assistant)({ type: 'start-session' } as unknown as AssistantTransportCommand);
    await waitFor(() => expect(adapter.initialize).toHaveBeenCalledOnce());
    void assistant.thread.append('hello');

    await waitFor(() => expect(generateTitle).toHaveBeenCalledOnce());
    expect(adapter.initialize).toHaveBeenCalledOnce();
  });

  it('posts the thread id from the first request with the default thread list', async () => {
    const requests = recordRequests();
    const { assistant } = await render(provideAssistantTransportRuntime(transportOptions()));

    void assistant.thread.append('first');
    await waitFor(() => expect(requests).toHaveLength(1));
    await waitFor(() => expect(assistant.thread.getState().isRunning).toBe(false));
    void assistant.thread.append('second');

    await waitFor(() => expect(requests).toHaveLength(2));
    const [first, second] = requests.map((request) => request.body['threadId']);
    expect(first).toEqual(expect.any(String));
    expect(second).toBe(first);
  });

  it('gives each thread of the default list its own runtime and state', async () => {
    const requests = recordRequests(
      () =>
        new Response(
          'aui-state:[{"type":"set","path":["messages"],"value":[{"id":"a","role":"assistant","text":"hi"}]}]\n',
        ),
    );
    const { assistant } = await render(
      provideAssistantTransportRuntime(
        transportOptions<ChatState>({ initialState: {}, converter: messagesConverter }),
      ),
    );

    void assistant.thread.append('first');
    await waitFor(() => expect(assistant.thread.getState().messages).toHaveLength(1));
    await waitFor(() => expect(assistant.thread.getState().isRunning).toBe(false));
    const firstThreadId = requests[0]!.body['threadId'];

    await assistant.threads.switchToNewThread();
    await ready(assistant);
    expect(assistant.thread.getState().messages).toHaveLength(0);
    void assistant.thread.append('second');

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.body['threadId']).not.toBe(firstThreadId);
    expect(requests[1]!.body['state']).toEqual({});
  });
});

describe('assistant transport requests', () => {
  it('posts the model context, headers and body fields with the commands', async () => {
    const requests = recordRequests();
    const { assistant } = await render(
      provideAssistantTransportRuntime(
        transportOptions({
          headers: async () => ({ Authorization: 'Bearer token' }),
          body: async () => ({ tenant: 'acme' }),
        }),
      ),
    );
    assistant.registerModelContextProvider({
      getModelContext: () => ({
        system: 'Be brief',
        tools: {
          lookup: { description: 'Looks up', parameters: { type: 'object', properties: {} } },
        },
        callSettings: { temperature: 0.5 },
        config: { modelName: 'small' },
      }),
    });

    void assistant.thread.append('hello');

    await waitFor(() => expect(requests).toHaveLength(1));
    const [{ url, headers, body }] = requests as [RecordedRequest];
    expect(url).toBe(API);
    expect(headers.get('Authorization')).toBe('Bearer token');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(body).toMatchObject({
      state: {},
      system: 'Be brief',
      tools: {
        lookup: { description: 'Looks up', parameters: { type: 'object', properties: {} } },
      },
      callSettings: { temperature: 0.5 },
      config: { modelName: 'small' },
      temperature: 0.5,
      modelName: 'small',
      tenant: 'acme',
      threadId: expect.any(String),
      parentId: null,
      commands: [{ type: 'add-message', message: { role: 'user', parts: [{ text: 'hello' }] } }],
    });
  });

  it('streams the assistant-transport protocol into the thread', async () => {
    const chunk = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    const set = (value: ChatState['messages']) =>
      chunk({ type: 'update-state', operations: [{ type: 'set', path: ['messages'], value }] });
    let push!: (text: string) => void;
    let close!: () => void;
    vi.stubGlobal('fetch', async () => {
      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            push = (text) => controller.enqueue(encoder.encode(text));
            close = () => controller.close();
          },
        }),
      );
    });
    const { assistant } = await render(
      provideAssistantTransportRuntime(
        transportOptions<ChatState>({
          protocol: 'assistant-transport',
          converter: messagesConverter,
        }),
      ),
    );

    void assistant.thread.append('hello');
    await waitFor(() => expect(assistant.thread.getState().isRunning).toBe(true));
    push(set([{ id: 'u', role: 'user', text: 'hello' }]));
    push(
      set([
        { id: 'u', role: 'user', text: 'hello' },
        { id: 'a', role: 'assistant', text: 'Hi there' },
      ]),
    );
    await waitFor(() => expect(assistant.thread.getState().messages).toHaveLength(2));
    expect(assistant.thread.getState().isRunning).toBe(true);

    push('data: [DONE]\n\n');
    close();
    await waitFor(() => expect(assistant.thread.getState().isRunning).toBe(false));
    expect(assistant.thread.getState().messages.map((message) => message.content)).toEqual([
      [{ type: 'text', text: 'hello' }],
      [{ type: 'text', text: 'Hi there' }],
    ]);
  });

  it('runs a frontend tool the server calls and sends its result as a command', async () => {
    const requests = recordRequests((url) =>
      url === API && requests.length === 1
        ? new Response('aui-state:[{"type":"set","path":["toolCall"],"value":true}]\n')
        : undefined,
    );
    const execute = vi.fn(async () => ({ sky: 'sunny' }));
    const toolCall: ThreadMessage = {
      id: 'a1',
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'tc1',
          toolName: 'weather',
          args: { city: 'Rome' },
          argsText: '{"city":"Rome"}',
        },
      ],
      createdAt: new Date(0),
      status: { type: 'requires-action', reason: 'tool-calls' },
      metadata: {
        unstable_state: {},
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
        custom: {},
      },
    };
    const { assistant } = await render(
      provideAssistantTransportRuntime(
        transportOptions<{ toolCall?: boolean }>({
          converter: (state, meta) => ({
            messages: state.toolCall ? [toolCall] : [],
            isRunning: meta.isSending,
          }),
        }),
      ),
    );
    assistant.registerModelContextProvider({
      getModelContext: () => ({
        tools: { weather: { parameters: { type: 'object', properties: {} }, execute } },
      }),
    });

    void assistant.thread.append('Weather in Rome?');

    await waitFor(() => expect(execute).toHaveBeenCalledWith({ city: 'Rome' }, expect.anything()));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.body['commands']).toEqual([
      {
        type: 'add-tool-result',
        toolCallId: 'tc1',
        toolName: 'weather',
        result: { sky: 'sunny' },
        isError: false,
      },
    ]);
    expect(requests[1]!.body['state']).toEqual({ toolCall: true });
  });
});

describe('assistant transport lifecycle', () => {
  it('runs an options factory once, in the injection context', async () => {
    const API_URL = new InjectionToken<string>('API_URL');
    const requests = recordRequests();
    const factory = vi.fn(() => transportOptions({ api: inject(API_URL) }));
    const { assistant } = await render(
      { provide: API_URL, useValue: 'http://localhost/injected' },
      provideAssistantTransportRuntime(factory),
    );

    void assistant.thread.append('first');
    await waitFor(() => expect(requests).toHaveLength(1));
    await waitFor(() => expect(assistant.thread.getState().isRunning).toBe(false));
    await assistant.threads.switchToNewThread();
    await ready(assistant);
    void assistant.thread.append('second');
    await waitFor(() => expect(requests).toHaveLength(2));

    expect(requests.map((request) => request.url)).toEqual([
      'http://localhost/injected',
      'http://localhost/injected',
    ]);
    expect(factory).toHaveBeenCalledOnce();
  });

  it('reports nothing when onError settles after the injector is destroyed', async () => {
    recordRequests(() => new Response('boom', { status: 500 }));
    const onErrorSettled = deferred<void>();
    const onError = vi.fn(() => onErrorSettled.promise);
    const onCancel = vi.fn();
    const { assistant, injector } = await render(
      provideAssistantTransportRuntime(transportOptions({ onError, onCancel })),
    );

    void assistant.thread.append('hello');
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
    injector.destroy();
    onErrorSettled.resolve();
    await nextTask();

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('aborts the running request without callbacks when the injector is destroyed', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', (_url: RequestInfo | URL, init: RequestInit = {}) => {
      signals.push(init.signal!);
      return new Promise<Response>((_resolve, reject) =>
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
      );
    });
    const onCancel = vi.fn();
    const onError = vi.fn();
    const onFinish = vi.fn();
    const { assistant, injector } = await render(
      provideAssistantTransportRuntime(transportOptions({ onCancel, onError, onFinish })),
    );

    void assistant.thread.append('hello');
    await waitFor(() => expect(signals).toHaveLength(1));
    injector.destroy();
    await nextTask();

    expect(signals[0]!.aborted).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
  });
});

describe('injectAssistantTransportState and injectAssistantTransportSendCommand', () => {
  @Component({
    selector: 'nxa-test-transport-state',
    template: `{{ reply() ?? 'none' }}`,
    changeDetection: ChangeDetectionStrategy.OnPush,
  })
  class TransportState {
    readonly state = injectAssistantTransportState<{ reply?: string }>();
    readonly reply = injectAssistantTransportState((state: { reply?: string }) => state?.reply);
    readonly strictReply = injectAssistantTransportState(
      (state: { reply?: string }) => state.reply,
    );
    readonly sendCommand = injectAssistantTransportSendCommand();
  }

  const setReply = (value: string) =>
    new Response(`aui-state:[{"type":"set","path":["reply"],"value":"${value}"}]\n`);

  it('reads the agent state, from the initial state before the first thread starts', async () => {
    const requests = recordRequests(() => setReply('pong'));
    TestBed.configureTestingModule({
      providers: [
        provideAssistantTransportRuntime(transportOptions({ initialState: { reply: 'initial' } })),
      ],
    });
    const fixture = TestBed.createComponent(TransportState);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toBe('initial');
    expect(() =>
      fixture.componentInstance.sendCommand({
        type: 'ping',
      } as unknown as AssistantTransportCommand),
    ).toThrow('[ngx-assistant] This thread does not run on an assistant transport');

    await waitFor(() => expect(fixture.componentInstance.state()).toEqual({ reply: 'initial' }));
    const assistant = TestBed.inject(EnvironmentInjector).runInContext(() => injectAssistant());
    await ready(assistant);
    fixture.componentInstance.sendCommand({ type: 'ping' } as unknown as AssistantTransportCommand);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.body['commands']).toEqual([{ type: 'ping' }]);
    expect(requests[0]!.body['state']).toEqual({ reply: 'initial' });

    await waitFor(() => expect(fixture.componentInstance.reply()).toBe('pong'));
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toBe('pong');
  });

  it('follows the thread the runtime shows', async () => {
    recordRequests(() => setReply('first thread'));
    TestBed.configureTestingModule({
      providers: [provideAssistantTransportRuntime(transportOptions())],
    });
    const fixture = TestBed.createComponent(TransportState);
    const assistant = TestBed.inject(EnvironmentInjector).runInContext(() => injectAssistant());
    await ready(assistant);

    fixture.componentInstance.sendCommand({ type: 'ping' } as unknown as AssistantTransportCommand);
    await waitFor(() => expect(fixture.componentInstance.reply()).toBe('first thread'));
    await waitFor(() => expect(assistant.thread.getState().isRunning).toBe(false));

    await assistant.threads.switchToNewThread();
    await waitFor(() => expect(fixture.componentInstance.reply()).toBeUndefined());
  });

  it('reads undefined inside a remote thread list until the thread starts', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRemoteThreadListRuntime({
          adapter: makeAdapter(),
          runtime: () =>
            provideAssistantTransportRuntime(transportOptions({ initialState: { reply: 'x' } })),
        }),
      ],
    });
    const fixture = TestBed.createComponent(TransportState);
    expect(fixture.componentInstance.state()).toBeUndefined();
    // The selector is not called while there is no state to select from.
    expect(fixture.componentInstance.strictReply()).toBeUndefined();

    await waitFor(() => expect(fixture.componentInstance.state()).toEqual({ reply: 'x' }));
  });

  it('throws on a thread of another runtime', async () => {
    const model: ChatModelAdapter = {
      async *run() {
        yield { content: [{ type: 'text', text: 'hi' }] };
      },
    };
    TestBed.configureTestingModule({ providers: [provideLocalRuntime(model)] });
    const fixture = TestBed.createComponent(TransportState);

    const message = '[ngx-assistant] This thread does not run on an assistant transport';
    expect(() => fixture.componentInstance.state()).toThrow(message);
    expect(() =>
      fixture.componentInstance.sendCommand({
        type: 'ping',
      } as unknown as AssistantTransportCommand),
    ).toThrow(message);
  });
});

describe('assistant transport history', () => {
  it('copies the settled turns of each thread of a remote thread list to its history', async () => {
    recordRequests(
      () =>
        new Response(
          'aui-state:[{"type":"set","path":["messages"],"value":[' +
            '{"id":"u","role":"user","text":"hello"},' +
            '{"id":"a","role":"assistant","text":"hi"}]}]\n',
        ),
    );
    const copies: { thread: string; ids: readonly string[] }[] = [];
    const { assistant } = await render(
      provideRemoteThreadListRuntime({
        adapter: makeAdapter(),
        runtime: () => [
          provideRuntimeAdapters(() => {
            const thread = inject(NXA_REMOTE_THREAD_ITEM)!.getState().id;
            return {
              history: {
                load: async () => ({ messages: [] }),
                append: async () => undefined,
                unstable_copy: async (_branch, ids) => void copies.push({ thread, ids }),
              },
            };
          }),
          provideAssistantTransportRuntime(
            transportOptions<ChatState>({ initialState: {}, converter: messagesConverter }),
          ),
        ],
      }),
    );
    const thread = assistant.threads.mainItem.getState().id;

    void assistant.thread.append('hello');

    await waitFor(() => expect(copies).toEqual([{ thread, ids: ['u', 'a'] }]));
  });
});
