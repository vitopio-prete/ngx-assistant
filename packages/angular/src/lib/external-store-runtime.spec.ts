import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  InjectionToken,
  computed,
  createEnvironmentInjector,
  inject,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  createMessageQueue,
  type AssistantRuntime,
  type AttachmentAdapter,
  type ExternalStoreAdapter,
  type RealtimeVoiceAdapter,
  type ThreadMessage,
} from '@ngx-assistant/engine';
import { provideExternalStoreRuntime } from './external-store-runtime';
import { fromRuntime } from './from-runtime';
import { injectAssistant, injectComposer, injectThread } from './scopes';

const message = (id: string, role: 'user' | 'assistant'): ThreadMessage =>
  ({
    id,
    role,
    createdAt: new Date(0),
    content: [{ type: 'text', text: id }],
    attachments: [],
    status: role === 'assistant' ? { type: 'complete', reason: 'stop' } : undefined,
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  }) as ThreadMessage;

const ids = (messages: readonly ThreadMessage[]) => messages.map((m) => m.id);

const injectorWith = (...providers: Parameters<typeof createEnvironmentInjector>[0]) =>
  createEnvironmentInjector(providers, TestBed.inject(EnvironmentInjector));

const assistantOf = (adapter: Parameters<typeof provideExternalStoreRuntime<ThreadMessage>>[0]) => {
  const injector = injectorWith(provideExternalStoreRuntime<ThreadMessage>(adapter));
  return { injector, runtime: injector.runInContext(() => injectAssistant()) };
};

const waitFor = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true));

const createVoiceSession = () => {
  const disconnect = vi.fn();
  const session: RealtimeVoiceAdapter.Session = {
    status: { type: 'running' },
    isMuted: false,
    disconnect,
    mute: vi.fn(),
    unmute: vi.fn(),
    onStatusChange: () => () => undefined,
    onTranscript: () => () => undefined,
    onModeChange: () => () => undefined,
    onVolumeChange: () => () => undefined,
  };
  return { session, disconnect };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('provideExternalStoreRuntime', () => {
  it('provides a runtime with its thread and composer scopes', () => {
    const injector = injectorWith(
      provideExternalStoreRuntime<ThreadMessage>({ messages: [], onNew: async () => undefined }),
    );
    const assistant = injector.runInContext(() => injectAssistant());

    expect(injector.runInContext(() => injectAssistant())).toBe(assistant);
    expect(injector.runInContext(() => injectThread())).toBe(assistant.thread);
    expect(injector.runInContext(() => injectComposer())).toBe(assistant.thread.composer);
    injector.destroy();
  });

  it('shows the messages of a plain adapter', () => {
    const { injector, runtime } = assistantOf({
      messages: [message('u0', 'user'), message('a0', 'assistant')],
      onNew: async () => undefined,
    });

    expect(ids(runtime.thread.getState().messages)).toEqual(['u0', 'a0']);
    injector.destroy();
  });

  it('creates nothing until the runtime is first injected', () => {
    const factory = vi.fn((): ExternalStoreAdapter<ThreadMessage> => ({
      messages: [],
      onNew: async () => undefined,
    }));
    const injector = injectorWith(provideExternalStoreRuntime(factory));
    expect(factory).not.toHaveBeenCalled();

    injector.runInContext(() => injectThread());
    injector.runInContext(() => injectThread());
    expect(factory).toHaveBeenCalledOnce();
    injector.destroy();
  });

  it('runs the factory in the injection context', async () => {
    const SEND = new InjectionToken<(text: string) => void>('SEND');
    const sent: string[] = [];
    const injector = injectorWith(
      { provide: SEND, useValue: (text: string) => sent.push(text) },
      provideExternalStoreRuntime<ThreadMessage>(() => {
        const send = inject(SEND);
        return {
          messages: [],
          onNew: async ({ content: [part] }) => send(part?.type === 'text' ? part.text : ''),
        };
      }),
    );
    const thread = injector.runInContext(() => injectThread());

    await thread.append('hello');
    expect(sent).toEqual(['hello']);
    injector.destroy();
  });

  it('follows the adapter held by a signal', () => {
    const messages = signal<readonly ThreadMessage[]>([message('u0', 'user')]);
    const isRunning = signal(false);
    const { injector, runtime } = assistantOf(() =>
      computed(() => ({
        messages: messages(),
        isRunning: isRunning(),
        onNew: async () => undefined,
      })),
    );
    const state = fromRuntime(runtime.thread, (s) => ids(s.messages), { injector });
    const running = fromRuntime(runtime.thread, (s) => s.isRunning, { injector });
    expect(state()).toEqual(['u0']);

    messages.update((current) => [...current, message('a0', 'assistant')]);
    isRunning.set(true);
    TestBed.tick();

    expect(state()).toEqual(['u0', 'a0']);
    expect(running()).toBe(true);
    injector.destroy();
  });

  it('sends through onNew and shows what the host appends', async () => {
    const messages = signal<readonly ThreadMessage[]>([]);
    const onNew = vi.fn(async () => {
      messages.update((current) => [...current, message('u1', 'user')]);
    });
    const { injector, runtime } = assistantOf(() =>
      computed(() => ({ messages: messages(), onNew })),
    );

    runtime.thread.composer.setText('hello');
    runtime.thread.composer.send();
    await waitFor(() => onNew.mock.calls.length === 1);
    TestBed.tick();

    expect(ids(runtime.thread.getState().messages)).toEqual(['u1']);
    injector.destroy();
  });

  it('notifies once per adapter change', () => {
    const messages = signal<readonly ThreadMessage[]>([message('m0', 'user')]);
    const { injector, runtime } = assistantOf(() =>
      computed(() => ({ messages: messages(), onNew: async () => undefined })),
    );
    let notifications = 0;
    const unsubscribe = runtime.thread.subscribe(() => notifications++);

    for (let i = 1; i <= 3; i++) {
      messages.update((all) => [...all, message(`m${i}`, i % 2 ? 'assistant' : 'user')]);
      TestBed.tick();
    }

    expect(notifications).toBe(3);
    expect(ids(runtime.thread.getState().messages)).toEqual(['m0', 'm1', 'm2', 'm3']);
    unsubscribe();
    injector.destroy();
  });

  it('follows the signal and disposes the thread from a component', async () => {
    const messages = signal<readonly ThreadMessage[]>([]);
    const { session, disconnect } = createVoiceSession();

    @Component({
      selector: 'nxa-test-chat',
      changeDetection: ChangeDetectionStrategy.OnPush,
      providers: [
        provideExternalStoreRuntime<ThreadMessage>(() =>
          computed(() => ({
            messages: messages(),
            onNew: async () => undefined,
            adapters: { voice: { connect: () => session } },
          })),
        ),
      ],
      template: `{{ count() }}`,
    })
    class Chat {
      readonly thread = injectThread();
      readonly count = fromRuntime(this.thread, (s) => s.messages.length);
    }

    const fixture = TestBed.createComponent(Chat);
    await fixture.whenStable();
    const thread = fixture.componentInstance.thread;

    messages.set([message('u0', 'user')]);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toBe('1');

    thread.connectVoice();
    await waitFor(() => thread.getState().voice !== undefined);
    fixture.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('follows a signal passed directly', () => {
    const messages = signal<readonly ThreadMessage[]>([]);
    const adapter = computed(() => ({ messages: messages(), onNew: async () => undefined }));
    const { injector, runtime } = assistantOf(adapter);

    messages.set([message('u0', 'user')]);
    TestBed.tick();
    expect(ids(runtime.thread.getState().messages)).toEqual(['u0']);
    injector.destroy();
  });

  it('disposes a replaced thread on switch and the current one on destroy', async () => {
    const first = createVoiceSession();
    const second = createVoiceSession();
    const sessions = [first.session, second.session];
    const threadId = signal('a');
    const { injector, runtime } = assistantOf(() =>
      computed(() => ({
        messages: [],
        onNew: async () => undefined,
        adapters: {
          threadList: { threadId: threadId() },
          voice: { connect: () => sessions.shift()! },
        },
      })),
    );

    runtime.thread.connectVoice();
    await waitFor(() => runtime.thread.getState().voice !== undefined);
    threadId.set('b');
    TestBed.tick();
    expect(first.disconnect).toHaveBeenCalledOnce();

    runtime.thread.connectVoice();
    await waitFor(() => runtime.thread.getState().voice !== undefined);
    expect(second.disconnect).not.toHaveBeenCalled();
    injector.destroy();
    expect(second.disconnect).toHaveBeenCalledOnce();
    expect(first.disconnect).toHaveBeenCalledOnce();
  });

  it('stops following the signal once the injector is destroyed', () => {
    const messages = signal<readonly ThreadMessage[]>([]);
    const { injector, runtime } = assistantOf(() =>
      computed(() => ({ messages: messages(), onNew: async () => undefined })),
    );
    injector.destroy();

    messages.set([message('u0', 'user')]);
    TestBed.tick();
    expect(runtime.thread.getState().messages).toEqual([]);
  });

  describe('lifecycle', () => {
    it('disconnects voice once when the injector is destroyed', async () => {
      const { session, disconnect } = createVoiceSession();
      const { injector, runtime } = assistantOf({
        messages: [],
        onNew: async () => undefined,
        adapters: { voice: { connect: () => session } },
      });

      runtime.thread.connectVoice();
      await waitFor(() => runtime.thread.getState().voice !== undefined);
      expect(disconnect).not.toHaveBeenCalled();

      injector.destroy();
      expect(disconnect).toHaveBeenCalledOnce();
    });

    it('aborts a pending attachment send when the injector is destroyed', async () => {
      let resolveSend!: () => void;
      const send = vi.fn<AttachmentAdapter['send']>(
        (attachment) =>
          new Promise((resolve) => {
            resolveSend = () =>
              resolve({ ...attachment, status: { type: 'complete' }, content: [] });
          }),
      );
      const attachments: AttachmentAdapter = {
        accept: '*',
        add: async ({ file }) => ({
          id: 'attachment-1',
          type: 'document',
          name: file.name,
          contentType: file.type,
          file,
          status: { type: 'requires-action', reason: 'composer-send' },
        }),
        remove: async () => undefined,
        send,
      };
      const onNew = vi.fn(async () => undefined);
      const { injector, runtime } = assistantOf({ messages: [], onNew, adapters: { attachments } });

      await runtime.thread.composer.addAttachment(
        new File(['hello'], 'notes.txt', { type: 'text/plain' }),
      );
      runtime.thread.composer.send();
      await waitFor(() => send.mock.calls.length === 1);
      const signal = send.mock.lastCall?.[1]?.signal;
      expect(signal?.aborted).toBe(false);

      injector.destroy();
      await Promise.resolve();
      resolveSend();
      await new Promise((resolve) => setTimeout(resolve));

      expect(onNew).not.toHaveBeenCalled();
      expect(signal?.aborted).toBe(true);
    });

    it('dispatches an append started before the injector is destroyed', async () => {
      let resolveInitialization!: () => void;
      const initialization = new Promise<void>((resolve) => {
        resolveInitialization = resolve;
      });
      const onNew = vi.fn(async () => undefined);
      const { injector, runtime } = assistantOf({ messages: [], onNew });
      const core = (
        runtime.thread as unknown as {
          __internal_threadBinding: {
            getState(): {
              __internal_setGetInitializePromise(getPromise: () => Promise<unknown>): void;
              append(message: unknown): Promise<void>;
            };
          };
        }
      ).__internal_threadBinding.getState();
      core.__internal_setGetInitializePromise(() => initialization);

      const appending = core.append({
        parentId: null,
        sourceId: null,
        runConfig: {},
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        attachments: [],
        metadata: { custom: {} },
        createdAt: new Date(0),
      });
      await Promise.resolve();
      expect(onNew).toHaveBeenCalledOnce();

      injector.destroy();
      resolveInitialization();
      await appending;
      expect(onNew).toHaveBeenCalledOnce();
    });

    it("dispatches a queued append after the thread's last message", async () => {
      const run = vi.fn();
      const queue = createMessageQueue({ run });
      const messages = signal<readonly ThreadMessage[]>([message('m1', 'user')]);
      const { injector, runtime } = assistantOf(() =>
        computed(() => ({
          messages: messages(),
          onNew: async () => undefined,
          queue: queue.adapter,
        })),
      );
      queue.notifyBusy();

      await runtime.thread.append({ role: 'user', content: [{ type: 'text', text: 'hello' }] });
      expect(run).not.toHaveBeenCalled();

      messages.set([message('m1', 'user'), message('m2', 'user')]);
      // The effect hands the new messages over at change detection, before the queue drains.
      TestBed.tick();
      queue.notifyIdle();

      expect(run).toHaveBeenCalledOnce();
      expect(run.mock.calls[0]![0].parentId).toBe('m2');
      injector.destroy();
    });

    it("dispatches a queued append after its own thread's last message when another runtime takes the queue during initialization", async () => {
      let resolveInitialization!: () => void;
      const initialization = new Promise<void>((resolve) => {
        resolveInitialization = resolve;
      });
      const run = vi.fn();
      const queue = createMessageQueue({ run });
      const first = assistantOf({
        messages: [message('m1', 'user')],
        onNew: async () => undefined,
        queue: queue.adapter,
      });
      (
        first.runtime.thread as unknown as {
          __internal_threadBinding: {
            getState(): {
              __internal_setGetInitializePromise(getPromise: () => Promise<unknown>): void;
            };
          };
        }
      ).__internal_threadBinding
        .getState()
        .__internal_setGetInitializePromise(() => initialization);

      const appending = first.runtime.thread.append({
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      });
      const second = assistantOf({
        messages: [message('x1', 'user')],
        onNew: async () => undefined,
        queue: queue.adapter,
      });
      resolveInitialization();
      await appending;

      expect(run).toHaveBeenCalledOnce();
      expect(run.mock.calls[0]![0].parentId).toBe('m1');
      first.injector.destroy();
      second.injector.destroy();
    });
  });

  describe('suggestions and send policy', () => {
    const withSuggestions = (
      prompts: ReturnType<typeof signal<string[] | undefined>>,
      isSendDisabled = signal<boolean | undefined>(undefined),
    ) =>
      assistantOf(() =>
        computed(() => {
          const current = prompts();
          const disabled = isSendDisabled();
          return {
            messages: [],
            onNew: async () => undefined,
            ...(disabled === undefined ? {} : { isSendDisabled: disabled }),
            ...(current && { suggestions: current.map((prompt) => ({ prompt })) }),
          };
        }),
      );

    it('exposes the runtime suggestions on the thread state', () => {
      const { injector, runtime } = withSuggestions(signal(['First']));
      expect(runtime.thread.getState().suggestions).toEqual([{ prompt: 'First' }]);
      injector.destroy();
    });

    it('reports no suggestions without runtime suggestions', () => {
      const { injector, runtime } = withSuggestions(signal(undefined));
      expect(runtime.thread.getState().suggestions).toEqual([]);
      injector.destroy();
    });

    it('follows runtime suggestion updates', () => {
      const prompts = signal<string[] | undefined>(['First']);
      const { injector, runtime } = withSuggestions(prompts);
      const suggestions = fromRuntime(runtime.thread, (s) => s.suggestions, { injector });

      prompts.set(['Second']);
      TestBed.tick();
      expect(suggestions()).toEqual([{ prompt: 'Second' }]);
      injector.destroy();
    });

    it('projects the send policy onto the thread state', () => {
      const isSendDisabled = signal<boolean | undefined>(false);
      const { injector, runtime } = withSuggestions(signal(undefined), isSendDisabled);
      expect(runtime.thread.getState().isSendDisabled).toBe(false);

      isSendDisabled.set(true);
      TestBed.tick();
      expect(runtime.thread.getState().isSendDisabled).toBe(true);
      injector.destroy();
    });
  });

  describe('cancel', () => {
    /** A host store like a component's: signals plus an adapter computed from them. */
    const host = (
      initial: ThreadMessage[],
      build: (state: {
        messages: ReturnType<typeof signal<readonly ThreadMessage[]>>;
        isRunning: ReturnType<typeof signal<boolean>>;
        current: readonly ThreadMessage[];
      }) => Partial<ExternalStoreAdapter<ThreadMessage>>,
      running = false,
    ) => {
      const messages = signal<readonly ThreadMessage[]>(initial);
      const isRunning = signal(running);
      const { injector, runtime } = assistantOf(() =>
        computed(() => {
          const current = messages();
          return {
            messages: current,
            isRunning: isRunning(),
            setMessages: (next: readonly ThreadMessage[]) => messages.set(next),
            onNew: async () => undefined,
            onCancel: async () => undefined,
            ...build({ messages, isRunning, current }),
          } as ExternalStoreAdapter<ThreadMessage>;
        }),
      );
      return { injector, runtime: runtime as AssistantRuntime, messages };
    };

    const settle = (runtime: AssistantRuntime, expected: string[]) =>
      vi.waitFor(() => {
        TestBed.tick();
        expect(ids(runtime.thread.getState().messages)).toEqual(expected);
      });

    it.each([
      { source: 'messages', refreshAfterVote: false },
      { source: 'messages', refreshAfterVote: true },
      { source: 'messageRepository', refreshAfterVote: true },
    ] as const)(
      'keeps an immediate send after stopping a rated reply with $source (host refresh: $refreshAfterVote)',
      async ({ source, refreshAfterVote }) => {
        let sent!: () => void;
        const onNewCalled = new Promise<void>((resolve) => {
          sent = resolve;
        });
        const setHostMessages = vi.fn();
        const { injector, runtime, messages } = host(
          [message('u0', 'user'), message('a0', 'assistant')],
          ({ messages, current }) => ({
            ...(source === 'messages'
              ? { messages: current }
              : {
                  messages: undefined,
                  messageRepository: {
                    messages: current.map((m, index) => ({
                      message: m,
                      parentId: current[index - 1]?.id ?? null,
                    })),
                  },
                }),
            setMessages: (next) => {
              setHostMessages(next);
              messages.set(next);
            },
            onNew: async () => {
              messages.update((all) => [...all, message('u1', 'user')]);
              sent();
            },
            adapters: { feedback: { submit: vi.fn() } },
          }),
        );

        runtime.thread.getMessageById('a0').submitFeedback({ type: 'positive' });
        if (refreshAfterVote) {
          messages.update((all) => [...all]);
          TestBed.tick();
        }
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        runtime.thread.cancelRun();
        void runtime.thread.append('hello');
        await onNewCalled;
        vi.runAllTimers();
        vi.useRealTimers();

        await settle(runtime, ['u0', 'a0', 'u1']);
        expect(ids(messages())).toEqual(['u0', 'a0', 'u1']);
        expect(setHostMessages).not.toHaveBeenCalled();
        injector.destroy();
      },
    );

    it('keeps a message sent right after a programmatic stop', async () => {
      let sent!: () => void;
      const onNewCalled = new Promise<void>((resolve) => {
        sent = resolve;
      });
      const { injector, runtime, messages } = host(
        [message('u0', 'user'), message('a0', 'assistant')],
        ({ messages }) => ({
          onNew: async () => {
            messages.update((all) => [...all, message('u1', 'user')]);
            sent();
          },
        }),
      );

      // The resync timer fires before the effect hands the host's new messages to the runtime.
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      runtime.thread.cancelRun();
      void runtime.thread.append('hello');
      await onNewCalled;
      vi.runAllTimers();
      vi.useRealTimers();

      await settle(runtime, ['u0', 'a0', 'u1']);
      expect(ids(messages())).toEqual(['u0', 'a0', 'u1']);
      injector.destroy();
    });

    it('keeps a message sent right after a programmatic stop that takes the unanswered message back', async () => {
      let sent!: () => void;
      const onNewCalled = new Promise<void>((resolve) => {
        sent = resolve;
      });
      const { injector, runtime, messages } = host(
        [message('u0', 'user'), message('a0', 'assistant'), message('u1', 'user')],
        ({ messages, isRunning }) => ({
          onNew: async () => {
            messages.update((all) => [...all, message('u2', 'user')]);
            sent();
          },
          onCancel: async () => isRunning.set(false),
        }),
        true,
      );

      vi.useFakeTimers({ toFake: ['setTimeout'] });
      runtime.thread.cancelRun();
      void runtime.thread.append('hello');
      await onNewCalled;
      vi.runAllTimers();
      vi.useRealTimers();

      await settle(runtime, ['u0', 'a0', 'u2']);
      expect(ids(messages())).toEqual(['u0', 'a0', 'u2']);
      expect(runtime.thread.composer.getState().text).toBe('u1');
      injector.destroy();
    });

    it("takes back the draft when a same-tick send uses the host's captured messages", async () => {
      const { injector, runtime, messages } = host(
        [message('u0', 'user'), message('a0', 'assistant'), message('u1', 'user')],
        ({ messages, current }) => ({
          isRunning: true,
          onNew: async () => messages.set([...current, message('u2', 'user')]),
        }),
      );

      vi.useFakeTimers({ toFake: ['setTimeout'] });
      runtime.thread.cancelRun();
      await runtime.thread.append('next');
      vi.runAllTimers();
      vi.useRealTimers();

      await vi.waitFor(() => {
        TestBed.tick();
        expect(ids(messages())).toEqual(['u0', 'a0', 'u1', 'u2']);
      });
      expect(runtime.thread.composer.getState().text).toBe('');
      injector.destroy();
    });

    it('keeps watching after a rollback snapshot precedes the captured send', async () => {
      let startNew!: () => void;
      const onNewStarted = new Promise<void>((resolve) => {
        startNew = resolve;
      });
      let finishNew!: () => void;
      const waitForNew = new Promise<void>((resolve) => {
        finishNew = resolve;
      });
      const { injector, runtime, messages } = host(
        [message('u0', 'user'), message('a0', 'assistant'), message('u1', 'user')],
        ({ messages, current }) => ({
          isRunning: true,
          onNew: async () => {
            startNew();
            await waitForNew;
            messages.set([...current, message('u2', 'user')]);
          },
        }),
      );

      runtime.thread.cancelRun();
      const sending = runtime.thread.append('next');
      await onNewStarted;
      await vi.waitFor(() => {
        TestBed.tick();
        expect(ids(messages())).toEqual(['u0', 'a0']);
      });
      expect(runtime.thread.composer.getState().text).toBe('u1');

      finishNew();
      await sending;
      await vi.waitFor(() => {
        TestBed.tick();
        expect(ids(messages())).toEqual(['u0', 'a0', 'u1', 'u2']);
      });
      expect(runtime.thread.composer.getState().text).toBe('');
      injector.destroy();
    });

    it('retracts the captured draft when the host snapshot arrives before the timer', async () => {
      const setHostMessages = vi.fn();
      const { injector, runtime, messages } = host(
        [message('u0', 'user'), message('a0', 'assistant'), message('u1', 'user')],
        ({ messages, current }) => ({
          isRunning: true,
          setMessages: (next) => {
            setHostMessages(next);
            messages.set(next);
          },
          onNew: async () => messages.set([...current, message('u2', 'user')]),
        }),
      );

      vi.useFakeTimers({ toFake: ['setTimeout'] });
      runtime.thread.cancelRun();
      await runtime.thread.append('next');
      TestBed.tick();

      expect(ids(messages())).toEqual(['u0', 'a0', 'u1', 'u2']);
      expect(runtime.thread.composer.getState().text).toBe('');
      expect(setHostMessages).toHaveBeenCalledOnce();
      expect(ids(setHostMessages.mock.lastCall![0])).toEqual(['u0', 'a0']);

      vi.runAllTimers();
      TestBed.tick();
      expect(setHostMessages).toHaveBeenCalledOnce();
      injector.destroy();
    });
  });
});
