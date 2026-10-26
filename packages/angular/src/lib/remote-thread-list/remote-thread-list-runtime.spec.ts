import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EnvironmentInjector,
  InjectionToken,
  type Provider,
  createEnvironmentInjector,
  inject,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  ChatModelAdapter,
  RemoteThreadListAdapter,
  RemoteThreadMetadata,
  ThreadListItemRuntime,
  ThreadMessage,
} from '@ngx-assistant/engine';
import { provideDataStreamRuntime } from '../data-stream';
import { provideExternalStoreRuntime } from '../external-store-runtime';
import { provideLocalRuntime } from '../local-runtime';
import { NXA_REMOTE_THREAD_ITEM, NXA_RUNTIME_ADAPTERS } from '../runtime-adapters';
import { injectAssistant } from '../scopes';
import {
  NxaThreadListItemRoot,
  NxaThreadListItemTitle,
  NxaThreadListItemTrigger,
  NxaThreadListItems,
  NxaThreadListRoot,
} from '../thread-list';
import {
  provideRemoteThreadListRuntime,
  type RemoteThreadListRuntimeOptions,
} from './remote-thread-list-runtime';

const emptyStream = () =>
  new ReadableStream({
    start(controller) {
      controller.close();
    },
  }) as never;

/** An adapter over an in-memory list whose methods are spies. */
const makeAdapter = (
  threads: RemoteThreadMetadata[] = [],
  overrides: Partial<RemoteThreadListAdapter> = {},
): RemoteThreadListAdapter => ({
  list: vi.fn(async () => ({ threads })),
  initialize: vi.fn(async (threadId: string) => ({ remoteId: `remote-${threadId}` })),
  rename: vi.fn(async () => undefined),
  archive: vi.fn(async () => undefined),
  unarchive: vi.fn(async () => undefined),
  delete: vi.fn(async () => undefined),
  generateTitle: vi.fn(async () => emptyStream()),
  fetch: vi.fn(async (remoteId: string) => ({ status: 'regular' as const, remoteId })),
  ...overrides,
});

const regular = (remoteId: string, title?: string): RemoteThreadMetadata => ({
  status: 'regular',
  remoteId,
  title,
});

const replyModel = (text = 'hello'): ChatModelAdapter => ({
  async *run() {
    yield { content: [{ type: 'text', text }] };
  },
});

/** A model that streams one chunk and then waits until the run is aborted. */
const blockingModel = () => {
  const signals: AbortSignal[] = [];
  const model: ChatModelAdapter = {
    async *run({ abortSignal }) {
      signals.push(abortSignal);
      yield { content: [{ type: 'text', text: 'partial' }] };
      await new Promise((resolve) => abortSignal.addEventListener('abort', resolve));
    },
  };
  return { model, signals };
};

const injectorWith = (...providers: Provider[]) =>
  createEnvironmentInjector(providers, TestBed.inject(EnvironmentInjector));

const setup = (options: RemoteThreadListRuntimeOptions, ...providers: Provider[]) => {
  const injector = injectorWith(...providers, provideRemoteThreadListRuntime(options));
  const assistant = injector.runInContext(() => injectAssistant());
  return { injector, assistant };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const waitFor = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('provideRemoteThreadListRuntime', () => {
  it('runs the main thread on a runtime made by the runtime providers', async () => {
    const { injector, assistant } = setup({
      adapter: makeAdapter(),
      runtime: () => provideLocalRuntime(replyModel('hi there')),
    });
    await flush();

    expect(assistant.threads.mainItem.getState().status).toBe('new');
    assistant.thread.append('ping');
    await waitFor(() => !assistant.thread.getState().isRunning);
    await waitFor(() => assistant.thread.getState().messages.length === 2);

    expect(assistant.thread.getState().messages[1]!.content).toEqual([
      { type: 'text', text: 'hi there' },
    ]);
    injector.destroy();
  });

  it('gives each thread injector its list item, the list adapters and the outer providers', async () => {
    const SERVICE = new InjectionToken<string>('SERVICE');
    const seen: { item: ThreadListItemRuntime | null; service: string; hasContext: boolean }[] = [];
    const { injector, assistant } = setup(
      {
        adapter: makeAdapter(),
        runtime: () =>
          provideLocalRuntime(replyModel(), () => {
            seen.push({
              item: inject(NXA_REMOTE_THREAD_ITEM),
              service: inject(SERVICE),
              hasContext: !!inject(NXA_RUNTIME_ADAPTERS)?.modelContext,
            });
            return {};
          }),
      },
      { provide: SERVICE, useValue: 'from the list injector' },
    );
    await flush();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.item!.getState().id).toBe(assistant.threads.mainItem.getState().id);
    expect(seen[0]!.service).toBe('from the list injector');
    expect(seen[0]!.hasContext).toBe(true);
    injector.destroy();
  });

  it('initializes a new thread on its first send and reports the remote id', async () => {
    const adapter = makeAdapter();
    const onThreadIdChange = vi.fn();
    const run = vi.fn<ChatModelAdapter['run']>(async () => ({
      content: [{ type: 'text' as const, text: 'hi' }],
    }));
    const { injector, assistant } = setup({
      adapter,
      runtime: () => provideLocalRuntime({ run }),
      onThreadIdChange,
    });
    await flush();
    const localId = assistant.threads.mainItem.getState().id;

    assistant.thread.append('ping');
    await waitFor(() => run.mock.calls.length === 1);

    expect(adapter.initialize).toHaveBeenCalledExactlyOnceWith(localId);
    expect(run.mock.calls[0]![0].unstable_threadId).toBe(`remote-${localId}`);
    await waitFor(() => onThreadIdChange.mock.calls.length > 0);
    expect(onThreadIdChange).toHaveBeenLastCalledWith(`remote-${localId}`);
    expect(assistant.threads.mainItem.getState()).toMatchObject({
      status: 'regular',
      remoteId: `remote-${localId}`,
    });
    injector.destroy();
  });

  it('keeps one runtime per thread across switches', async () => {
    const { injector, assistant } = setup({
      adapter: makeAdapter([regular('thread-a'), regular('thread-b')]),
      runtime: () => provideLocalRuntime(replyModel()),
    });
    await assistant.threads.switchToThread('thread-a');
    assistant.thread.append('in a');
    await waitFor(() => assistant.thread.getState().messages.length === 2);

    await assistant.threads.switchToThread('thread-b');
    expect(assistant.thread.getState().messages).toHaveLength(0);

    await assistant.threads.switchToThread('thread-a');
    expect(assistant.thread.getState().messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    injector.destroy();
  });

  it('destroys the injector of a deleted thread', async () => {
    const destroyed: string[] = [];
    const { injector, assistant } = setup({
      adapter: makeAdapter([regular('thread-a')]),
      runtime: () =>
        provideLocalRuntime(replyModel(), () => {
          const id = inject(NXA_REMOTE_THREAD_ITEM)!.getState().remoteId;
          inject(DestroyRef).onDestroy(() => destroyed.push(id ?? 'new'));
          return {};
        }),
    });
    await assistant.threads.switchToThread('thread-a');

    await assistant.threads.getItemById('thread-a').delete();

    expect(destroyed).toEqual(['thread-a']);
    injector.destroy();
  });

  it('aborts the running stream of every thread when the list is destroyed', async () => {
    const { model, signals } = blockingModel();
    const adapter = makeAdapter();
    const { injector, assistant } = setup({
      adapter,
      runtime: () => provideLocalRuntime(model),
    });
    await flush();
    assistant.thread.append('ping');
    await waitFor(() => signals.length === 1);

    injector.destroy();

    expect(signals[0]!.aborted).toBe(true);
  });

  it('switches with the threadId signal without echoing it', async () => {
    const threadId = signal<string | undefined>(undefined);
    const onThreadIdChange = vi.fn();
    const { injector, assistant } = setup({
      adapter: makeAdapter([regular('thread-a'), regular('thread-b')]),
      runtime: () => provideLocalRuntime(replyModel()),
      threadId,
      onThreadIdChange,
    });
    await flush();

    threadId.set('thread-b');
    TestBed.tick();
    await waitFor(() => assistant.threads.getState().mainThreadId === 'thread-b');

    threadId.set(undefined);
    TestBed.tick();
    await waitFor(() => assistant.threads.mainItem.getState().status === 'new');
    expect(onThreadIdChange).not.toHaveBeenCalled();

    await assistant.threads.switchToThread('thread-a');
    expect(onThreadIdChange).toHaveBeenLastCalledWith('thread-a');
    injector.destroy();
  });

  it('starts on the thread of the threadId signal', async () => {
    const { injector, assistant } = setup({
      adapter: makeAdapter([regular('thread-a')]),
      runtime: () => provideLocalRuntime(replyModel()),
      threadId: signal('thread-a'),
    });

    await waitFor(() => assistant.threads.getState().mainThreadId === 'thread-a');
    injector.destroy();
  });

  it('reloads the list from a replacement adapter', async () => {
    const adapter = signal(makeAdapter([regular('thread-a')]));
    const { injector, assistant } = setup({
      adapter,
      runtime: () => provideLocalRuntime(replyModel()),
    });
    await waitFor(() => assistant.threads.getState().threadIds.includes('thread-a'));

    adapter.set(makeAdapter([regular('thread-b')]));
    TestBed.tick();

    await waitFor(() => assistant.threads.getState().threadIds.join() === 'thread-b');
    injector.destroy();
  });

  it('rejects a switch when the runtime providers provide no runtime', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { injector, assistant } = setup({
      adapter: makeAdapter([regular('thread-a')]),
      runtime: () => [],
    });
    await flush();

    await expect(assistant.threads.switchToThread('thread-a')).rejects.toThrow(
      'provide no runtime',
    );
    consoleError.mockRestore();
    injector.destroy();
  });

  it('reloads a failed list when the browser comes back online', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const list = vi
      .fn<RemoteThreadListAdapter['list']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ threads: [regular('thread-a')] });
    const { injector, assistant } = setup({
      adapter: makeAdapter([], { list }),
      runtime: () => provideLocalRuntime(replyModel()),
    });
    await waitFor(() => list.mock.calls.length === 1);
    await flush();

    window.dispatchEvent(new Event('online'));

    await waitFor(() => assistant.threads.getState().threadIds.includes('thread-a'));
    expect(list).toHaveBeenCalledTimes(2);
    injector.destroy();
    window.dispatchEvent(new Event('online'));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('calls the runtime providers in the injection context of the list', async () => {
    const MODEL = new InjectionToken<ChatModelAdapter>('MODEL');
    const { injector, assistant } = setup(
      {
        adapter: makeAdapter(),
        runtime: () => provideLocalRuntime(inject(MODEL)),
      },
      { provide: MODEL, useValue: replyModel('injected') },
    );
    await flush();

    assistant.thread.append('ping');

    await waitFor(() => assistant.thread.getState().messages.length === 2);
    expect(assistant.thread.getState().messages[1]!.content).toEqual([
      { type: 'text', text: 'injected' },
    ]);
    injector.destroy();
  });

  it('opens a thread whose runtime providers failed once on the next switch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let failures = 1;
    const { injector, assistant } = setup({
      adapter: makeAdapter([regular('thread-a')]),
      runtime: () =>
        provideLocalRuntime(() => {
          if (inject(NXA_REMOTE_THREAD_ITEM)!.getState().remoteId === 'thread-a' && failures-- > 0)
            throw new Error('transient');
          return replyModel();
        }),
    });
    await flush();

    await expect(assistant.threads.switchToThread('thread-a')).rejects.toThrow('transient');
    await assistant.threads.switchToThread('thread-a');

    expect(assistant.threads.getState().mainThreadId).toBe('thread-a');
    injector.destroy();
  });

  it('destroys every thread injector with the list', async () => {
    const destroyed: string[] = [];
    const { injector, assistant } = setup({
      adapter: makeAdapter([regular('thread-a')]),
      runtime: () =>
        provideLocalRuntime(replyModel(), () => {
          const id = inject(NXA_REMOTE_THREAD_ITEM)!.getState().id;
          inject(DestroyRef).onDestroy(() => destroyed.push(id));
          return {};
        }),
    });
    const draftId = assistant.threads.mainItem.getState().id;
    await assistant.threads.switchToThread('thread-a');
    expect(destroyed).toEqual([]);

    injector.destroy();

    expect([...destroyed].sort()).toEqual([draftId, 'thread-a'].sort());
  });

  it('stops the running threads of the previous adapter', async () => {
    const { model, signals } = blockingModel();
    const adapter = signal(makeAdapter([regular('thread-a')]));
    const { injector, assistant } = setup({
      adapter,
      runtime: () => provideLocalRuntime(model),
    });
    await assistant.threads.switchToThread('thread-a');
    assistant.thread.append('ping');
    await waitFor(() => signals.length === 1);

    adapter.set(makeAdapter([regular('thread-b')]));
    TestBed.tick();

    await waitFor(() => signals[0]!.aborted);
    injector.destroy();
  });

  it('keeps a thread running after switching away from it', async () => {
    const { model, signals } = blockingModel();
    const { injector, assistant } = setup({
      adapter: makeAdapter([regular('thread-a'), regular('thread-b')]),
      runtime: () => provideLocalRuntime(model),
    });
    await assistant.threads.switchToThread('thread-a');
    assistant.thread.append('ping');
    await waitFor(() => signals.length === 1);

    await assistant.threads.switchToThread('thread-b');
    expect(signals[0]!.aborted).toBe(false);
    expect(assistant.threads.getItemById('thread-a').getState().isRunning).toBe(true);

    await assistant.threads.switchToThread('thread-a');
    assistant.thread.cancelRun();
    expect(signals[0]!.aborted).toBe(true);
    injector.destroy();
  });

  it('reloads a failed list when the page becomes visible', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const list = vi
      .fn<RemoteThreadListAdapter['list']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ threads: [regular('thread-a')] });
    const { injector, assistant } = setup({
      adapter: makeAdapter([], { list }),
      runtime: () => provideLocalRuntime(replyModel()),
    });
    await waitFor(() => list.mock.calls.length === 1);
    await flush();

    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => assistant.threads.getState().threadIds.includes('thread-a'));
    injector.destroy();
  });

  it('warns about adapter fields made for component frameworks', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { injector } = setup({
      adapter: makeAdapter([], { unstable_useAdapters: () => null }),
      runtime: () => provideLocalRuntime(replyModel()),
    });
    await flush();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unstable_useAdapters'));
    injector.destroy();
  });

  it('applies the list feedback adapter to an external store thread runtime', async () => {
    const submit = vi.fn();
    const { injector, assistant } = setup({
      adapter: makeAdapter(),
      runtime: () => [
        { provide: NXA_RUNTIME_ADAPTERS, useFactory: () => ({ feedback: { submit } }) },
        provideExternalStoreRuntime<ThreadMessage>({ messages: [], onNew: async () => undefined }),
      ],
    });
    await flush();

    expect(assistant.thread.getState().capabilities.feedback).toBe(true);
    injector.destroy();
  });

  it('sends the tools and instructions of the list with each thread run', async () => {
    const run = vi.fn<ChatModelAdapter['run']>(async () => ({
      content: [{ type: 'text' as const, text: 'hi' }],
    }));
    const { injector, assistant } = setup({
      adapter: makeAdapter(),
      runtime: () => provideLocalRuntime({ run }),
    });
    const unregister = assistant.registerModelContextProvider({
      getModelContext: () => ({ system: 'Be brief.' }),
      subscribe: () => () => undefined,
    });
    await flush();

    assistant.thread.append('ping');
    await waitFor(() => run.mock.calls.length === 1);

    expect(run.mock.calls[0]![0].context.system).toBe('Be brief.');
    unregister();
    injector.destroy();
  });

  it('registers the list model context on an external store thread runtime', async () => {
    let context: unknown;
    const { injector, assistant } = setup({
      adapter: makeAdapter(),
      runtime: () =>
        provideExternalStoreRuntime<ThreadMessage>({
          messages: [],
          onNew: async () => {
            context = assistant.thread.getModelContext().system;
          },
        }),
    });
    assistant.registerModelContextProvider({
      getModelContext: () => ({ system: 'From the list.' }),
      subscribe: () => () => undefined,
    });
    await flush();

    assistant.thread.append('ping');

    await waitFor(() => context !== undefined);
    expect(context).toBe('From the list.');
    injector.destroy();
  });

  it('sends the remote thread id and the list tools with a data stream thread', async () => {
    const sse = (chunks: readonly Record<string, unknown>[]) =>
      `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          sse([
            { type: 'start', messageId: 'reply' },
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: 'hi' },
            { type: 'text-end', id: 't' },
            { type: 'finish', finishReason: 'stop' },
          ]),
          { headers: { 'x-vercel-ai-ui-message-stream': 'v1' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { injector, assistant } = setup({
      adapter: makeAdapter(),
      runtime: () => provideDataStreamRuntime({ api: '/api/chat' }),
    });
    assistant.registerModelContextProvider({
      getModelContext: () => ({
        tools: {
          weather: {
            description: 'Weather of a city',
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
          },
        },
      }),
      subscribe: () => () => undefined,
    });
    await flush();
    const localId = assistant.threads.mainItem.getState().id;

    assistant.thread.append('ping');
    await waitFor(() => fetchMock.mock.calls.length === 1);

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body['threadId']).toBe(`remote-${localId}`);
    expect(Object.keys(body['tools'] as object)).toEqual(['weather']);
    await waitFor(() => !assistant.thread.getState().isRunning);
    injector.destroy();
  });
});

const ADAPTER = new InjectionToken<RemoteThreadListAdapter>('ADAPTER');

@Component({
  selector: 'nxa-test-remote-list',
  imports: [
    NxaThreadListRoot,
    NxaThreadListItems,
    NxaThreadListItemRoot,
    NxaThreadListItemTrigger,
    NxaThreadListItemTitle,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    provideRemoteThreadListRuntime(() => ({
      adapter: inject(ADAPTER),
      runtime: () => provideLocalRuntime(replyModel()),
    })),
  ],
  template: `
    <nav nxaThreadListRoot>
      <div *nxaThreadListItems="let thread" nxaThreadListItemRoot class="item">
        <button nxaThreadListItemTrigger class="trigger">
          <span nxaThreadListItemTitle fallback="New chat"></span>
        </button>
      </div>
    </nav>
  `,
})
class RemoteListHost {}

describe('provideRemoteThreadListRuntime with the thread list primitives', () => {
  it('lists the remote threads and switches on a trigger click', async () => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ADAPTER,
          useValue: makeAdapter([regular('thread-a', 'First'), regular('thread-b', 'Second')]),
        },
      ],
    });
    const fixture = TestBed.createComponent(RemoteListHost);
    const element = fixture.nativeElement as HTMLElement;
    await waitFor(() => {
      fixture.detectChanges();
      return element.querySelectorAll('.item').length === 2;
    });
    expect(
      Array.from(element.querySelectorAll('.item'), (item) => item.textContent?.trim()),
    ).toEqual(['First', 'Second']);

    element.querySelectorAll<HTMLButtonElement>('.trigger')[1]!.click();

    await waitFor(() => {
      fixture.detectChanges();
      return element.querySelector('.item[data-active]')?.textContent?.trim() === 'Second';
    });
    fixture.destroy();
  });
});
