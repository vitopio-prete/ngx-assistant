import {
  EnvironmentInjector,
  InjectionToken,
  createEnvironmentInjector,
  inject,
  type Provider,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  AttachmentAdapter,
  ChatModelAdapter,
  FeedbackAdapter,
  RemoteThreadListAdapter,
  ThreadHistoryAdapter,
  ThreadMessage,
} from '@ngx-assistant/engine';
import { provideExternalStoreRuntime } from './external-store-runtime';
import { provideLocalRuntime } from './local-runtime';
import { provideRemoteThreadListRuntime } from './remote-thread-list';
import { NXA_REMOTE_THREAD_ITEM, provideRuntimeAdapters } from './runtime-adapters';
import { injectAssistant } from './scopes';

const replyModel = (): ChatModelAdapter => ({
  async *run() {
    yield { content: [{ type: 'text', text: 'hi' }] };
  },
});

const historyAdapter = (): ThreadHistoryAdapter & { load: ReturnType<typeof vi.fn> } => ({
  load: vi.fn(async () => ({ messages: [] })),
  append: vi.fn(async () => undefined),
});

const attachmentAdapter = (accept = '*'): AttachmentAdapter => ({
  accept,
  add: async ({ file }) => ({
    id: file.name,
    type: 'document',
    name: file.name,
    contentType: file.type,
    file,
    status: { type: 'requires-action', reason: 'composer-send' },
  }),
  remove: async () => undefined,
  send: async (attachment) => ({ ...attachment, status: { type: 'complete' }, content: [] }),
});

const feedbackAdapter = (): FeedbackAdapter => ({ submit: vi.fn() });

const remoteListAdapter = (): RemoteThreadListAdapter => ({
  list: async () => ({ threads: [] }),
  initialize: async (threadId) => ({ remoteId: threadId, externalId: undefined }),
  rename: async () => undefined,
  archive: async () => undefined,
  unarchive: async () => undefined,
  delete: async () => undefined,
  generateTitle: async () =>
    new ReadableStream({ start: (controller) => controller.close() }) as never,
  fetch: async (threadId) => ({ status: 'regular', remoteId: threadId }),
});

const injectorWith = (...providers: Provider[]) =>
  createEnvironmentInjector(providers, TestBed.inject(EnvironmentInjector));

const waitFor = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('provideRuntimeAdapters', () => {
  it('hands its history and attachment adapters to a local runtime', async () => {
    const history = historyAdapter();
    const injector = injectorWith(
      provideRuntimeAdapters({ history, attachments: attachmentAdapter() }),
      provideLocalRuntime(replyModel()),
    );
    const assistant = injector.runInContext(() => injectAssistant());

    await waitFor(() => history.load.mock.calls.length === 1);
    expect(assistant.thread.getState().capabilities.attachments).toBe(true);
    injector.destroy();
  });

  it("lets a runtime's own adapters apply over its adapters", async () => {
    const provided = historyAdapter();
    const own = historyAdapter();
    const injector = injectorWith(
      provideRuntimeAdapters({ history: provided }),
      provideLocalRuntime(replyModel(), { adapters: { history: own } }),
    );
    injector.runInContext(() => injectAssistant());

    await waitFor(() => own.load.mock.calls.length === 1);
    expect(provided.load).not.toHaveBeenCalled();
    injector.destroy();
  });

  it('merges its adapters over those of an outer injector', async () => {
    const outer = historyAdapter();
    const inner = historyAdapter();
    const feedback = feedbackAdapter();
    const parent = injectorWith(provideRuntimeAdapters({ history: outer, feedback }));
    const injector = createEnvironmentInjector(
      [provideRuntimeAdapters({ history: inner }), provideLocalRuntime(replyModel())],
      parent,
    );
    const assistant = injector.runInContext(() => injectAssistant());

    await waitFor(() => inner.load.mock.calls.length === 1);
    expect(outer.load).not.toHaveBeenCalled();
    expect(assistant.thread.getState().capabilities.feedback).toBe(true);
    injector.destroy();
    parent.destroy();
  });

  it('runs a factory once, in the injection context', () => {
    const FEEDBACK = new InjectionToken<FeedbackAdapter>('FEEDBACK');
    const factory = vi.fn(() => ({ feedback: inject(FEEDBACK) }));
    const injector = injectorWith(
      { provide: FEEDBACK, useValue: feedbackAdapter() },
      provideRuntimeAdapters(factory),
      provideExternalStoreRuntime<ThreadMessage>({ messages: [], onNew: async () => undefined }),
    );
    const assistant = injector.runInContext(() => injectAssistant());

    expect(assistant.thread.getState().capabilities.feedback).toBe(true);
    expect(factory).toHaveBeenCalledOnce();
    injector.destroy();
  });

  it('applies its feedback adapter to an external store only when the store brings none', () => {
    const provided = feedbackAdapter();
    const own = feedbackAdapter();
    const injector = injectorWith(
      provideRuntimeAdapters({ feedback: provided }),
      provideExternalStoreRuntime<ThreadMessage>({
        messages: [
          {
            id: 'a',
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
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
        ],
        onNew: async () => undefined,
        adapters: { feedback: own },
      }),
    );
    const assistant = injector.runInContext(() => injectAssistant());

    assistant.thread.getMessageById('a').submitFeedback({ type: 'positive' });
    expect(own.submit).toHaveBeenCalledOnce();
    expect(provided.submit).not.toHaveBeenCalled();
    injector.destroy();
  });

  it('does not hand its attachment adapter to an external store', () => {
    const injector = injectorWith(
      provideRuntimeAdapters({ attachments: attachmentAdapter() }),
      provideExternalStoreRuntime<ThreadMessage>({ messages: [], onNew: async () => undefined }),
    );
    const assistant = injector.runInContext(() => injectAssistant());

    expect(assistant.thread.getState().capabilities.attachments).toBe(false);
    injector.destroy();
  });

  it('never replaces the model context of the thread list', async () => {
    let system: string | undefined;
    const injector = injectorWith(
      provideRuntimeAdapters({
        feedback: feedbackAdapter(),
        modelContext: { getModelContext: () => ({ system: 'Provided.' }) },
      } as never),
      provideRemoteThreadListRuntime({
        adapter: remoteListAdapter(),
        runtime: () =>
          provideLocalRuntime({
            async *run({ context }) {
              system = context.system;
              yield { content: [{ type: 'text', text: 'hi' }] };
            },
          }),
      }),
    );
    const assistant = injector.runInContext(() => injectAssistant());
    assistant.registerModelContextProvider({
      getModelContext: () => ({ system: 'From the list.' }),
      subscribe: () => () => undefined,
    });
    await flush();

    expect(assistant.thread.getState().capabilities.feedback).toBe(true);
    assistant.thread.append('ping');
    await waitFor(() => system !== undefined);
    expect(system).toBe('From the list.');
    injector.destroy();
  });

  it('builds adapters for each thread of a remote thread list and keeps the list model context', async () => {
    const histories = new Map<string, ThreadHistoryAdapter & { load: ReturnType<typeof vi.fn> }>();
    let system: string | undefined;
    const injector = injectorWith(
      provideRemoteThreadListRuntime({
        adapter: remoteListAdapter(),
        runtime: () => [
          provideRuntimeAdapters(() => {
            const history = historyAdapter();
            histories.set(inject(NXA_REMOTE_THREAD_ITEM)!.getState().id, history);
            return { history };
          }),
          provideLocalRuntime({
            async *run({ context }) {
              system = context.system;
              yield { content: [{ type: 'text', text: 'hi' }] };
            },
          }),
        ],
      }),
    );
    const assistant = injector.runInContext(() => injectAssistant());
    assistant.registerModelContextProvider({
      getModelContext: () => ({ system: 'From the list.' }),
      subscribe: () => () => undefined,
    });
    await flush();
    const first = assistant.threads.mainItem.getState().id;
    assistant.thread.append('ping');
    await waitFor(() => system !== undefined && !assistant.thread.getState().isRunning);
    expect(system).toBe('From the list.');
    await assistant.threads.switchToNewThread();
    await flush();
    const second = assistant.threads.mainItem.getState().id;

    expect([...histories.keys()]).toEqual([first, second]);
    await waitFor(() => histories.get(second)!.load.mock.calls.length === 1);
    expect(histories.get(first)!.append).toHaveBeenCalled();
    expect(histories.get(second)!.append).not.toHaveBeenCalled();
    injector.destroy();
  });
});
