import {
  EnvironmentInjector,
  createEnvironmentInjector,
  signal,
  type Provider,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ExportedMessageRepository,
  type AssistantRuntime,
  type CompleteAttachment,
  type ExternalStoreAdapter,
  type ThreadHistoryAdapter,
  type ThreadMessage,
  type ThreadUserMessage,
} from '@ngx-assistant/engine';
import { provideExternalStoreRuntime } from './external-store-runtime';
import { provideRuntimeAdapters } from './runtime-adapters';
import { injectAssistant } from './scopes';

const user = (id: string): ThreadUserMessage => ({
  id,
  role: 'user',
  content: [{ type: 'text', text: id }],
  attachments: [],
  createdAt: new Date(0),
  metadata: { custom: {} },
});

const assistant = (id: string): ThreadMessage => ({
  id,
  role: 'assistant',
  content: [{ type: 'text', text: id }],
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

const toolCall = (id: string): ThreadMessage =>
  ({
    ...assistant(id),
    content: [
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'choose', args: {}, argsText: '{}' },
    ],
  }) as ThreadMessage;

const historyAdapter = () => {
  const unstable_copy = vi.fn<NonNullable<ThreadHistoryAdapter['unstable_copy']>>(
    async () => undefined,
  );
  const history: ThreadHistoryAdapter = {
    load: async () => ExportedMessageRepository.fromArray([]),
    append: async () => undefined,
    unstable_copy,
  };
  return { history, unstable_copy };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

const setup = (
  history?: ThreadHistoryAdapter,
  initial: ExternalStoreAdapter<ThreadMessage> = {
    messages: [],
    isRunning: false,
    onNew: async () => undefined,
  },
) => {
  const store = signal(initial);
  const providers: Provider[] = [provideExternalStoreRuntime(store)];
  if (history) providers.unshift(provideRuntimeAdapters({ history }));
  const injector = createEnvironmentInjector(providers, TestBed.inject(EnvironmentInjector));
  const runtime: AssistantRuntime = injector.runInContext(() => injectAssistant());
  const update = (next: Partial<ExternalStoreAdapter<ThreadMessage>>) => {
    store.update((current) => ({ ...current, ...next }));
    TestBed.tick();
  };
  const interact = (payload: Record<string, string> = {}) =>
    runtime.thread.getMessageById('assistant-1').getMessagePartByToolCallId('call-1')
      .unstable_recordInteraction!({ type: 'action', payload });
  return { runtime, update, interact, destroy: () => injector.destroy() };
};

const idsOf = (messages: readonly ThreadMessage[]) => messages.map((message) => message.id);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('provideExternalStoreRuntime history copy', () => {
  it('copies the settled branch in order with new message ids', async () => {
    const { history, unstable_copy } = historyAdapter();
    const app = setup(history);
    app.update({ isRunning: true });
    app.update({ isRunning: false, messages: [user('user-1'), assistant('assistant-1')] });
    await settle();

    expect(unstable_copy).toHaveBeenCalledOnce();
    expect(idsOf(unstable_copy.mock.calls[0]![0])).toEqual(['user-1', 'assistant-1']);
    expect(unstable_copy.mock.calls[0]![1]).toEqual(['user-1', 'assistant-1']);
    app.destroy();
  });

  it('does not copy while running', async () => {
    const { history, unstable_copy } = historyAdapter();
    const app = setup(history);
    app.update({ isRunning: true, messages: [user('user-1')] });
    await settle();

    expect(unstable_copy).not.toHaveBeenCalled();
    app.destroy();
  });

  it('does not copy a loaded branch until a run adds a message', async () => {
    const { history, unstable_copy } = historyAdapter();
    const loaded = user('loaded');
    const app = setup(history, {
      messages: [loaded],
      isRunning: false,
      onNew: async () => undefined,
    });
    await settle();
    expect(unstable_copy).not.toHaveBeenCalled();

    app.update({ isRunning: true });
    app.update({ isRunning: false, messages: [loaded, assistant('answer')] });
    await settle();

    expect(idsOf(unstable_copy.mock.calls[0]![0])).toEqual(['loaded', 'answer']);
    expect(unstable_copy.mock.calls[0]![1]).toEqual(['answer']);
    app.destroy();
  });

  it("leaves unchanged messages out of the next run's ids", async () => {
    const { history, unstable_copy } = historyAdapter();
    const app = setup(history);
    const first = user('user-1');
    app.update({ isRunning: true });
    app.update({ isRunning: false, messages: [first] });
    await settle();
    app.update({ isRunning: true });
    app.update({ isRunning: false, messages: [first, assistant('assistant-2')] });
    await settle();

    expect(unstable_copy.mock.calls[1]![1]).toEqual(['assistant-2']);
    app.destroy();
  });

  describe('attachment changes', () => {
    const attachment: CompleteAttachment = {
      id: 'file-1',
      type: 'document',
      name: 'report.pdf',
      status: { type: 'complete' },
      content: [{ type: 'file', data: 'cGRm', mimeType: 'application/pdf' }],
    };

    it.each([
      { change: 'added', before: [], after: [attachment], changed: true },
      { change: 'removed', before: [attachment], after: [], changed: true },
      {
        change: 'replaced under the same attachment id',
        before: [attachment],
        after: [
          {
            ...attachment,
            content: [{ type: 'file' as const, data: 'bmV3', mimeType: 'application/pdf' }],
          },
        ],
        changed: true,
      },
      {
        change: 'recreated with identical values',
        before: [attachment],
        after: [
          {
            ...attachment,
            status: { ...attachment.status },
            content: attachment.content.map((part) => ({ ...part })),
          },
        ],
        changed: false,
      },
    ])(
      'copies only changed messages when attachments are $change',
      async ({ before, after, changed }) => {
        const { history, unstable_copy } = historyAdapter();
        const app = setup(history);
        const first: ThreadUserMessage = { ...user('user-1'), attachments: before };
        const next: ThreadUserMessage = { ...first, attachments: after };

        app.update({ isRunning: true });
        app.update({ isRunning: false, messages: [first] });
        await settle();
        app.update({ isRunning: true });
        app.update({ isRunning: false, messages: [next, assistant('answer')] });
        await settle();
        app.destroy();

        expect(unstable_copy).toHaveBeenCalledTimes(2);
        expect(unstable_copy.mock.calls[1]![1]).toEqual(
          changed ? ['user-1', 'answer'] : ['answer'],
        );
        expect(unstable_copy.mock.calls[1]![0][0]).toMatchObject({ attachments: after });
      },
    );
  });

  it('skips stores that persist their own history', async () => {
    const { history, unstable_copy } = historyAdapter();
    const app = setup(history, {
      messages: [],
      isRunning: false,
      unstable_persistsHistory: true,
      onNew: async () => undefined,
    });
    app.update({ isRunning: true });
    app.update({ isRunning: false, messages: [user('user-1')] });
    await settle();

    expect(unstable_copy).not.toHaveBeenCalled();
    app.destroy();
  });

  it('skips stores that run their own thread list', async () => {
    const { history, unstable_copy } = historyAdapter();
    const app = setup(history, {
      messages: [],
      isRunning: false,
      adapters: { threadList: { threadId: 'backend-thread' } },
      onNew: async () => undefined,
    });
    app.update({ isRunning: true });
    app.update({ isRunning: false, messages: [user('user-1')] });
    await settle();

    expect(unstable_copy).not.toHaveBeenCalled();
    app.destroy();
  });

  it('stops copying when the store starts persisting its own history', async () => {
    const { history, unstable_copy } = historyAdapter();
    const app = setup(history);
    app.update({ unstable_persistsHistory: true });
    app.update({ isRunning: true });
    app.update({ isRunning: false, messages: [user('user-1')] });
    await settle();

    expect(unstable_copy).not.toHaveBeenCalled();
    app.destroy();
  });

  it('copies again once the store stops persisting its own history', async () => {
    const { history, unstable_copy } = historyAdapter();
    const app = setup(history, {
      messages: [],
      isRunning: false,
      unstable_persistsHistory: true,
      onNew: async () => undefined,
    });
    const first = user('user-1');
    app.update({ isRunning: true });
    app.update({ isRunning: false, messages: [first] });
    app.update({ unstable_persistsHistory: false });
    app.update({ isRunning: true });
    app.update({ isRunning: false, messages: [first, assistant('assistant-2')] });
    await settle();

    expect(unstable_copy).toHaveBeenCalledOnce();
    expect(unstable_copy.mock.calls[0]![1]).toEqual(['assistant-2']);
    app.destroy();
  });

  it('rejects a pending interaction when the injector is destroyed before its copy', async () => {
    const { history, unstable_copy } = historyAdapter();
    const app = setup(history, {
      messages: [toolCall('assistant-1')],
      isRunning: false,
      onNew: async () => undefined,
    });
    const pending = app.interact();
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    app.destroy();

    await expect(pending).rejects.toThrow('History copy was detached.');
    await settle();
    expect(unstable_copy).not.toHaveBeenCalled();
  });

  it('omits optimistic, fallback, running, and synthetic error messages', async () => {
    const { history, unstable_copy } = historyAdapter();
    const app = setup(history);
    const optimistic = {
      ...assistant('optimistic'),
      metadata: { ...assistant('optimistic').metadata, isOptimistic: true },
    } as ThreadMessage;
    const running = { ...assistant('running'), status: { type: 'running' } } as ThreadMessage;
    app.update({ isRunning: true });
    app.update({
      isRunning: false,
      messages: [
        user('user-1'),
        optimistic,
        user('__external_store_fallback_1'),
        user('__error__1'),
        running,
        assistant('assistant-1'),
      ],
    });
    await settle();

    expect(idsOf(unstable_copy.mock.calls[0]![0])).toEqual(['user-1', 'assistant-1']);
    expect(unstable_copy.mock.calls[0]![1]).toEqual(['user-1', 'assistant-1']);
    app.destroy();
  });

  it('omits the messages the engine gives fallback ids', async () => {
    const { history, unstable_copy } = historyAdapter();
    const app = setup(history, {
      messages: [],
      isRunning: false,
      onNew: async () => undefined,
      // A converted message without an id gets a fallback id from the engine.
      convertMessage: (message) =>
        message.id === 'no-id' ? { role: 'user', content: 'no id' } : message,
    });
    app.update({ isRunning: true });
    app.update({ isRunning: false, messages: [user('user-1'), user('no-id')] });
    await settle();

    expect(app.runtime.thread.getState().messages[1]!.id).toMatch(/^__external_store_fallback_/);
    expect(idsOf(unstable_copy.mock.calls[0]![0])).toEqual(['user-1']);
    app.destroy();
  });

  it('records an interaction in the copy without changing the runtime message', async () => {
    const { history, unstable_copy } = historyAdapter();
    const message = toolCall('assistant-1');
    const app = setup(history, {
      messages: [message],
      isRunning: false,
      onNew: async () => undefined,
    });
    await app.interact({ choice: 'yes' });

    const copied = unstable_copy.mock.calls[0]![0][0]!;
    expect(unstable_copy.mock.calls[0]![1]).toEqual(['assistant-1']);
    expect(copied.content[0]).toMatchObject({
      unstable_interactions: { entries: [{ type: 'action', payload: { choice: 'yes' } }] },
    });
    expect(message.content[0]).not.toHaveProperty('unstable_interactions');
    expect(
      app.runtime.thread.getMessageById('assistant-1').getState().content[0],
    ).not.toHaveProperty('unstable_interactions');
    app.destroy();
  });

  it('records during a run and copies the interaction with other new messages at run end', async () => {
    const { history, unstable_copy } = historyAdapter();
    const message = toolCall('assistant-1');
    const app = setup(history, {
      messages: [message],
      isRunning: false,
      onNew: async () => undefined,
    });
    app.update({ isRunning: true });
    app.update({ messages: [message, user('user-2')] });
    await app.interact();
    expect(unstable_copy).not.toHaveBeenCalled();

    app.update({ isRunning: false });
    await settle();
    expect(unstable_copy.mock.calls[0]![1]).toEqual(['assistant-1', 'user-2']);
    app.destroy();
  });

  it("keeps a store's own interaction handler", async () => {
    const { history, unstable_copy } = historyAdapter();
    const onRecord = vi.fn(async () => undefined);
    const app = setup(history, {
      messages: [toolCall('assistant-1')],
      isRunning: false,
      onNew: async () => undefined,
      unstable_onRecordToolInteraction: onRecord,
    });
    await app.interact();

    expect(onRecord).toHaveBeenCalledOnce();
    expect(unstable_copy).not.toHaveBeenCalled();
    app.destroy();
  });

  it('rejects an idle interaction when its copy fails', async () => {
    const { history, unstable_copy } = historyAdapter();
    unstable_copy.mockRejectedValueOnce(new Error('offline'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = setup(history, {
      messages: [toolCall('assistant-1')],
      isRunning: false,
      onNew: async () => undefined,
    });

    await expect(app.interact()).rejects.toThrow('offline');
    expect(unstable_copy).toHaveBeenCalledOnce();
    app.destroy();
  });

  it('retries a failed copy with the same ids on the next run end', async () => {
    const { history, unstable_copy } = historyAdapter();
    unstable_copy.mockRejectedValueOnce(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = setup(history);
    app.update({ isRunning: true });
    app.update({ isRunning: false, messages: [user('user-1')] });
    await settle();
    app.update({ isRunning: true });
    app.update({ isRunning: false });
    await settle();

    expect(unstable_copy.mock.calls.map((call) => call[1])).toEqual([['user-1'], ['user-1']]);
    expect(warn).toHaveBeenCalledOnce();
    app.destroy();
  });

  it('queues one more copy when a run ends during an in-flight copy', async () => {
    const { history, unstable_copy } = historyAdapter();
    let finishFirst!: () => void;
    unstable_copy.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finishFirst = () => resolve(undefined);
        }),
    );
    const app = setup(history);
    const first = user('user-1');
    app.update({ isRunning: true });
    app.update({ isRunning: false, messages: [first] });
    await settle();
    app.update({ isRunning: true });
    app.update({ isRunning: false, messages: [first, assistant('assistant-2')] });
    await settle();
    expect(unstable_copy).toHaveBeenCalledOnce();

    finishFirst();
    await settle();
    expect(unstable_copy).toHaveBeenCalledTimes(2);
    expect(unstable_copy.mock.calls[1]![1]).toEqual(['assistant-2']);
    app.destroy();
  });

  it.each(['no history', 'history without copy'])(
    'keeps unsupported recording behavior with %s',
    async (caseName) => {
      const { history, unstable_copy } = historyAdapter();
      const message = toolCall('assistant-1');
      const withoutCopy: ThreadHistoryAdapter = { ...history, unstable_copy: undefined };
      const app = setup(caseName === 'no history' ? undefined : withoutCopy, {
        messages: [message],
        isRunning: false,
        onNew: async () => undefined,
      });

      await expect(app.interact()).rejects.toThrow(
        'Runtime does not support recording tool interactions.',
      );
      app.update({ isRunning: true });
      app.update({ isRunning: false, messages: [message, user('user-2')] });
      await settle();
      expect(unstable_copy).not.toHaveBeenCalled();
      app.destroy();
    },
  );
});
