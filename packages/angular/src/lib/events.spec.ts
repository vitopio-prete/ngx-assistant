import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  ErrorHandler,
  Injector,
  createComponent,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  AssistantRuntime,
  AttachmentAdapter,
  ChatModelAdapter,
  ThreadListRuntime,
} from '@ngx-assistant/engine';
import { injectNxaEvent, type NxaEventName, type NxaEvents } from './events';
import { provideLocalRuntime, type LocalRuntimeOptions } from './local-runtime';
import {
  NXA_COMPOSER,
  injectAssistant,
  injectThread,
  provideAssistantScope,
  provideMessageScope,
} from './scopes';

const replyModel = (text = 'hello'): ChatModelAdapter => ({
  async *run() {
    yield { content: [{ type: 'text', text }] };
  },
});

const failingModel = (): ChatModelAdapter => ({
  // eslint-disable-next-line require-yield
  async *run() {
    throw new Error('model down');
  },
});

/** A model that streams one chunk and then waits until the run is aborted. */
const blockingModel = (): ChatModelAdapter => ({
  async *run({ abortSignal }) {
    yield { content: [{ type: 'text', text: 'partial' }] };
    await new Promise((resolve) => abortSignal.addEventListener('abort', resolve));
  },
});

const attachments: AttachmentAdapter = {
  accept: '*',
  async add({ file }) {
    return {
      id: file.name,
      type: 'file',
      name: file.name,
      contentType: file.type,
      file,
      status: { type: 'requires-action', reason: 'composer-send' },
    };
  },
  async send(attachment) {
    return { ...attachment, status: { type: 'complete' }, content: [] };
  },
  async remove() {
    return undefined;
  },
};

type ThreadListRuntimeEvent = Parameters<
  ThreadListRuntime['unstable_subscribeThreadEvents']
>[0] extends (event: infer E) => void
  ? E
  : never;

const twoMessages: LocalRuntimeOptions = {
  initialMessages: [
    { id: 'm0', role: 'user', content: 'first' },
    { id: 'm1', role: 'user', content: 'second' },
  ],
};

const injectorWith = (
  providers: Parameters<typeof createEnvironmentInjector>[0],
  parent: EnvironmentInjector = TestBed.inject(EnvironmentInjector),
) => createEnvironmentInjector(providers, parent);

const runtimeInjector = (model = replyModel(), options: LocalRuntimeOptions = {}) =>
  injectorWith(provideLocalRuntime(model, options));

/** Subscribes in `injector` and records every payload. */
const listen = <E extends NxaEventName>(
  injector: Injector,
  selector: Parameters<typeof injectNxaEvent<E>>[0],
) => {
  const calls: NxaEvents[E][] = [];
  const ref = injectNxaEvent<E>(selector, (payload) => calls.push(payload), { injector });
  return { calls, ref };
};

/**
 * An assistant over a local runtime whose thread list can be driven by hand: the local runtime
 * neither switches threads nor keeps other threads alive.
 */
const fakeAssistant = (runtime: Injector) => {
  const real = runtimeOf(runtime);
  let mainThreadId = real.threads.getState().mainThreadId;
  const listeners = new Set<() => void>();
  const threadEvents = new Set<(event: ThreadListRuntimeEvent) => void>();
  const assistant = {
    get thread() {
      return real.thread;
    },
    threads: {
      getState: () => ({ ...real.threads.getState(), mainThreadId }),
      subscribe: (callback: () => void) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
      unstable_subscribeThreadEvents: (callback: (event: ThreadListRuntimeEvent) => void) => {
        threadEvents.add(callback);
        return () => threadEvents.delete(callback);
      },
    },
  } as unknown as AssistantRuntime;
  const select = (threadId: string) => {
    mainThreadId = threadId;
    for (const listener of listeners) listener();
  };
  return { assistant, select, threadEvents };
};

const runtimeOf = (injector: Injector) => runInInjectionContext(injector, () => injectAssistant());

@Component({ changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class Empty {}

const file = (name: string) => new File(['x'], name, { type: 'text/plain' });

const flush = () => new Promise<void>((resolve) => setTimeout(resolve));
const waitFor = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true));

const sendAndSettle = async (injector: Injector, text = 'ping') => {
  const thread = runInInjectionContext(injector, () => injectThread());
  thread.composer.setText(text);
  thread.composer.send();
  await waitFor(() => !thread.getState().isRunning);
  await flush();
  return thread;
};

describe('injectNxaEvent', () => {
  describe('delivery', () => {
    it('delivers events to the callback', async () => {
      const injector = runtimeInjector();
      const { calls } = listen(injector, 'composer.send');

      const thread = await sendAndSettle(injector, 'hello');

      expect(calls).toEqual([{ threadId: thread.getState().threadId, chars: 5, attachments: 0 }]);
      injector.destroy();
    });

    it('stops delivering after the injector is destroyed', async () => {
      const runtime = runtimeInjector();
      const listener = injectorWith([], runtime);
      const { calls } = listen(listener, 'thread.runEnd');

      await sendAndSettle(runtime);
      expect(calls).toHaveLength(1);

      listener.destroy();
      await sendAndSettle(runtime);
      expect(calls).toHaveLength(1);
      runtime.destroy();
    });

    it('stops delivering after the ref is destroyed, and a second destroy does nothing', async () => {
      const injector = runtimeInjector();
      const { calls, ref } = listen(injector, 'thread.runEnd');

      ref.destroy();
      ref.destroy();
      await sendAndSettle(injector);

      expect(calls).toEqual([]);
      injector.destroy();
    });

    it('stops delivering when the providing component is destroyed', async () => {
      const calls: unknown[] = [];

      @Component({
        changeDetection: ChangeDetectionStrategy.OnPush,
        providers: [provideLocalRuntime(replyModel())],
        template: '',
      })
      class Host {
        readonly thread = injectThread();
        constructor() {
          injectNxaEvent('thread.runStart', (payload) => calls.push(payload));
        }
      }

      const fixture = TestBed.createComponent(Host);
      const { thread } = fixture.componentInstance;
      thread.composer.setText('ping');
      thread.composer.send();
      await waitFor(() => !thread.getState().isRunning);
      await flush();
      expect(calls).toHaveLength(1);

      fixture.destroy();
      thread.composer.setText('again');
      thread.composer.send();
      await flush();
      expect(calls).toHaveLength(1);
    });

    it('delivers on a microtask, with the state already updated', async () => {
      const injector = runtimeInjector();
      const thread = injector.runInContext(() => injectThread());
      const seen: { text: string; messages: number }[] = [];
      injectNxaEvent(
        'composer.send',
        () =>
          seen.push({
            text: thread.composer.getState().text,
            messages: thread.getState().messages.length,
          }),
        { injector },
      );

      thread.composer.setText('ping');
      thread.composer.send();
      expect(seen).toEqual([]);

      await Promise.resolve();
      expect(seen).toEqual([{ text: '', messages: 2 }]);
      await waitFor(() => !thread.getState().isRunning);
      injector.destroy();
    });

    it('skips an emission when the ref is destroyed before the microtask runs', async () => {
      const injector = runtimeInjector();
      const thread = injector.runInContext(() => injectThread());
      const { calls, ref } = listen(injector, 'composer.send');

      thread.composer.setText('ping');
      thread.composer.send();
      ref.destroy();
      await waitFor(() => !thread.getState().isRunning);
      await flush();

      expect(calls).toEqual([]);
      injector.destroy();
    });

    it('reports a throwing or rejecting callback to the ErrorHandler and keeps delivering', async () => {
      const handleError = vi.fn();
      const injector = injectorWith([
        { provide: ErrorHandler, useValue: { handleError } },
        provideLocalRuntime(replyModel()),
      ]);
      const thrown = new Error('sync');
      const rejected = new Error('async');
      injectNxaEvent(
        'thread.runEnd',
        () => {
          throw thrown;
        },
        { injector },
      );
      injectNxaEvent('thread.runEnd', () => Promise.reject(rejected), { injector });
      const { calls } = listen(injector, 'thread.runEnd');

      await sendAndSettle(injector);
      await waitFor(() => handleError.mock.calls.length === 2);

      expect(handleError).toHaveBeenCalledWith(thrown);
      expect(handleError).toHaveBeenCalledWith(rejected);
      expect(calls).toHaveLength(1);
      injector.destroy();
    });
  });

  describe('scopes', () => {
    it('throws without the scope, like injectThread()', () => {
      const injector = injectorWith([]);
      expect(() => listen(injector, 'thread.runEnd')).toThrow(/No thread scope here/);

      const runtime = runtimeInjector();
      expect(() => listen(runtime, 'message.error')).toThrow(/No message scope here/);
      runtime.destroy();
      injector.destroy();
    });

    it('rejects a scope that does not contain the event source, and an unknown event', () => {
      const injector = runtimeInjector();
      expect(() => listen(injector, { scope: 'message', event: 'thread.runEnd' } as never)).toThrow(
        '[ngx-assistant] Event "thread.runEnd" cannot be heard in the "message" scope.',
      );
      for (const event of ['thread.unknown', 'message.copied', 'threads.unknown', 'constructor']) {
        expect(() => listen(injector, { scope: '*', event } as never)).toThrow(
          `[ngx-assistant] Unknown event "${event}".`,
        );
      }
      injector.destroy();
    });

    it('requires an injection context or an injector', () => {
      expect(() => injectNxaEvent('thread.runEnd', () => undefined)).toThrow(/NG0203/);
    });

    it('hears only the nearest composer: inside a message scope, its edit composer', async () => {
      const runtime = runtimeInjector(replyModel(), { ...twoMessages, adapters: { attachments } });
      const thread = runtime.runInContext(() => injectThread());
      const message = injectorWith(
        provideMessageScope(() => thread.getMessageById('m0')),
        runtime,
      );
      const threadComposer = listen(runtime, 'composer.attachmentAdd');
      const editComposer = listen(message, 'composer.attachmentAdd');
      const viaMessage = listen(message, { scope: 'message', event: 'composer.attachmentAdd' });
      const viaThread = listen(message, { scope: 'thread', event: 'composer.attachmentAdd' });

      const edit = thread.getMessageById('m0').composer;
      edit.beginEdit();
      await edit.addAttachment(file('a.txt'));
      await flush();

      const threadId = thread.getState().threadId;
      const expected = { threadId, messageId: 'm0', contentType: 'text/plain' };
      expect(threadComposer.calls).toEqual([]);
      expect(editComposer.calls).toEqual([expected]);
      expect(viaMessage.calls).toEqual([expected]);
      expect(viaThread.calls).toEqual([expected]);

      await thread.composer.addAttachment(file('b.txt'));
      await flush();
      expect(threadComposer.calls).toEqual([{ threadId, contentType: 'text/plain' }]);
      expect(editComposer.calls).toHaveLength(1);
      expect(viaThread.calls).toHaveLength(2);
      message.destroy();
      runtime.destroy();
    });

    it('in the thread scope, follows the edit composers of messages added later', async () => {
      const injector = runtimeInjector(replyModel(), { adapters: { attachments } });
      const { calls } = listen(injector, { scope: 'thread', event: 'composer.attachmentAdd' });
      const thread = await sendAndSettle(injector, 'hi');
      const userId = thread.getState().messages[0]!.id;

      const edit = thread.getMessageById(userId).composer;
      edit.beginEdit();
      await edit.addAttachment(file('a.txt'));
      await flush();

      expect(calls.map((c) => c.messageId)).toEqual([userId]);
      injector.destroy();
    });

    it('subscribes nothing through a destroyed component injector', async () => {
      const runtime = runtimeInjector();
      const component = createComponent(Empty, { environmentInjector: runtime });
      const injector = component.injector;
      component.destroy();

      const calls: unknown[] = [];
      expect(() =>
        injectNxaEvent('thread.runStart', (payload) => calls.push(payload), { injector }),
      ).toThrow(/NG0911/);
      await sendAndSettle(runtime);

      expect(calls).toEqual([]);
      runtime.destroy();
    });

    it('finds the message of an edit composer provided without its message scope', async () => {
      const runtime = runtimeInjector(replyModel(), { ...twoMessages, adapters: { attachments } });
      const thread = runtime.runInContext(() => injectThread());
      const byId = injectorWith(
        [{ provide: NXA_COMPOSER, useFactory: () => thread.getMessageById('m0').composer }],
        runtime,
      );
      const byIndex = injectorWith(
        [{ provide: NXA_COMPOSER, useFactory: () => thread.getMessageByIndex(1).composer }],
        runtime,
      );
      const onId = listen(byId, 'composer.attachmentAdd');
      const onIndex = listen(byIndex, 'composer.attachmentAdd');

      for (const id of ['m0', 'm1']) {
        const edit = thread.getMessageById(id).composer;
        edit.beginEdit();
        await edit.addAttachment(file(`${id}.txt`));
      }
      await flush();

      expect(onId.calls.map((c) => c.messageId)).toEqual(['m0']);
      expect(onIndex.calls.map((c) => c.messageId)).toEqual(['m1']);
      byId.destroy();
      byIndex.destroy();
      runtime.destroy();
    });

    it('in the "*" scope, hears every composer and message of the main thread', async () => {
      const runtime = runtimeInjector(failingModel(), { adapters: { attachments } });
      const attachmentsAdded = listen(runtime, { scope: '*', event: 'composer.attachmentAdd' });
      const errors = listen(runtime, { scope: '*', event: 'message.error' });
      const thread = runtime.runInContext(() => injectThread());

      await thread.composer.addAttachment(file('a.txt'));
      await sendAndSettle(runtime);
      const [user, reply] = thread.getState().messages;
      const edit = thread.getMessageById(user!.id).composer;
      edit.beginEdit();
      await edit.addAttachment(file('b.txt'));
      await flush();

      expect(attachmentsAdded.calls.map((c) => c.messageId)).toEqual([undefined, user!.id]);
      expect(errors.calls.map((c) => c.messageId)).toEqual([reply!.id]);
      runtime.destroy();
    });

    it('reports attachments added to a composer', async () => {
      const injector = runtimeInjector(replyModel(), { adapters: { attachments } });
      const thread = injector.runInContext(() => injectThread());
      const added = listen(injector, 'composer.attachmentAdd');
      const failed = listen(injector, 'composer.attachmentAddError');

      await thread.composer.addAttachment(file('a.txt'));
      await flush();

      const threadId = thread.getState().threadId;
      expect(added.calls).toEqual([{ threadId, contentType: 'text/plain' }]);
      expect(failed.calls).toEqual([]);
      injector.destroy();
    });

    it('reports an attachment that cannot be added, without the raw error', async () => {
      const injector = runtimeInjector(replyModel(), {
        adapters: {
          attachments: {
            ...attachments,
            add: () => Promise.reject(new Error('too big')),
          },
        },
      });
      const thread = injector.runInContext(() => injectThread());
      const { calls } = listen(injector, 'composer.attachmentAddError');

      await thread.composer.addAttachment(file('a.txt')).catch(() => undefined);
      await flush();

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ threadId: thread.getState().threadId, message: 'too big' });
      expect(calls[0]).not.toHaveProperty('error');
      injector.destroy();
    });
  });

  describe('thread events', () => {
    it('reports a run from start to end once, also when cancelled mid-stream', async () => {
      const injector = runtimeInjector(blockingModel());
      const thread = injector.runInContext(() => injectThread());
      const starts = listen(injector, 'thread.runStart');
      const ends = listen(injector, 'thread.runEnd');

      thread.composer.setText('ping');
      thread.composer.send();
      await waitFor(() => thread.getState().messages[1]?.content.length === 1);
      await flush();
      expect(starts.calls).toHaveLength(1);
      expect(ends.calls).toEqual([]);

      thread.cancelRun();
      await waitFor(() => !thread.getState().isRunning);
      await flush();
      expect(ends.calls).toEqual([{ threadId: thread.getState().threadId }]);
      expect(starts.calls).toHaveLength(1);
      injector.destroy();
    });

    it('reports the thread initialization once', async () => {
      const injector = runtimeInjector();
      const { calls } = listen(injector, 'thread.initialize');

      await sendAndSettle(injector);
      await sendAndSettle(injector);

      expect(calls).toHaveLength(1);
      injector.destroy();
    });

    it('replays the initialization to a subscription made once the thread is initialized', async () => {
      const injector = runtimeInjector();
      const thread = await sendAndSettle(injector);
      const { calls } = listen(injector, 'thread.initialize');

      await flush();
      await sendAndSettle(injector);

      expect(calls).toEqual([{ threadId: thread.getState().threadId }]);
      injector.destroy();
    });

    it('reports an answered tool approval', async () => {
      let runs = 0;
      const model: ChatModelAdapter = {
        async run() {
          if (runs++ > 0) return { content: [{ type: 'text', text: 'done' }] };
          return {
            content: [
              {
                type: 'tool-call',
                toolCallId: 'call-1',
                toolName: 'send_email',
                args: {},
                argsText: '{}',
                approval: { id: 'a1' },
              },
            ],
            status: { type: 'requires-action', reason: 'tool-calls' },
          };
        },
      };
      const injector = runtimeInjector(model);
      const { calls } = listen(injector, 'thread.toolApprovalAnswered');
      const thread = await sendAndSettle(injector);
      const reply = thread.getMessageByIndex(1);

      await reply.getMessagePartByIndex(0).respondToToolApproval({ approved: false });
      await waitFor(() => !thread.getState().isRunning);
      await flush();

      expect(calls).toEqual([
        {
          threadId: thread.getState().threadId,
          messageId: reply.getState().id,
          toolCallId: 'call-1',
          toolName: 'send_email',
          approved: false,
        },
      ]);
      injector.destroy();
    });

    it('reports a model context update', async () => {
      const injector = runtimeInjector();
      const assistant = injector.runInContext(() => injectAssistant());
      const { calls } = listen(injector, 'thread.modelContextUpdate');

      const unregister = assistant.registerModelContextProvider({
        getModelContext: () => ({ system: 'be brief' }),
      });
      await flush();

      expect(calls).toEqual([{ threadId: assistant.thread.getState().threadId }]);
      unregister();
      injector.destroy();
    });

    it('reports a failed history write without the raw error', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const injector = runtimeInjector(replyModel(), {
        adapters: {
          history: {
            load: async () => ({ messages: [] }),
            append: () => Promise.reject(new Error('disk full')),
          },
        },
      });
      const { calls } = listen(injector, 'thread.historyWriteError');

      const thread = await sendAndSettle(injector);
      await waitFor(() => calls.length > 0);

      expect(calls[0]).toEqual({
        threadId: thread.getState().threadId,
        operation: 'append',
        messageIds: [thread.getState().messages[0]!.id],
        message: 'disk full',
      });
      error.mockRestore();
      injector.destroy();
    });

    it('in the "*" scope, also hears the threads that are not the main one', async () => {
      const runtime = runtimeInjector();
      const { assistant, threadEvents } = fakeAssistant(runtime);
      const injector = injectorWith(
        provideAssistantScope(() => assistant),
        runtime,
      );
      const everywhere = listen(injector, { scope: '*', event: 'thread.runEnd' });
      const threads = listen(injector, { scope: 'threads', event: 'thread.runEnd' });
      const nearest = listen(injector, 'thread.runEnd');
      const main = assistant.threads.getState().mainThreadId;

      for (const notify of threadEvents) {
        notify({ threadId: 'background', type: 'runEnd' });
        notify({ threadId: 'background', type: 'runStart' });
        notify({ threadId: main, type: 'runEnd' }); // the main thread is heard directly
      }
      await flush();

      expect(everywhere.calls).toEqual([{ threadId: 'background' }]);
      expect(threads.calls).toEqual([{ threadId: 'background' }]);
      expect(nearest.calls).toEqual([]);

      everywhere.ref.destroy();
      threads.ref.destroy();
      expect(threadEvents.size).toBe(0);
      injector.destroy();
      runtime.destroy();
    });
  });

  describe('message.error', () => {
    it('reports a message entering the error status once', async () => {
      const injector = runtimeInjector(failingModel());
      const thread = injector.runInContext(() => injectThread());
      const { calls } = listen(injector, { scope: 'thread', event: 'message.error' });

      await sendAndSettle(injector);
      const assistantId = thread.getState().messages[1]!.id;
      thread.composer.setText('typing');
      await flush();

      expect(calls).toEqual([
        { threadId: thread.getState().threadId, messageId: assistantId, reason: 'error' },
      ]);
      injector.destroy();
    });

    it('hears only the message of its scope', async () => {
      const runtime = runtimeInjector(failingModel(), twoMessages);
      const thread = runtime.runInContext(() => injectThread());
      const second = injectorWith(
        provideMessageScope(() => thread.getMessageByIndex(1)),
        runtime,
      );
      const onSecond = listen(second, 'message.error');
      const onThread = listen(second, { scope: 'thread', event: 'message.error' });

      await sendAndSettle(runtime);

      const replyId = thread.getState().messages[3]!.id;
      expect(onSecond.calls).toEqual([]);
      expect(onThread.calls).toEqual([
        { threadId: thread.getState().threadId, messageId: replyId, reason: 'error' },
      ]);
      second.destroy();
      runtime.destroy();
    });

    it('follows a runtime taken by index to the message it points at now', async () => {
      const runtime = runtimeInjector(failingModel(), twoMessages);
      const thread = runtime.runInContext(() => injectThread());
      const scope = injectorWith(
        provideMessageScope(() => thread.getMessageByIndex(1)),
        runtime,
      );
      const { calls } = listen(scope, 'message.error');

      // Editing the first message starts a branch: index 1 now holds the reply, which fails.
      const edit = thread.getMessageById('m0').composer;
      edit.beginEdit();
      edit.setText('edited');
      edit.send();
      await waitFor(() => !thread.getState().isRunning);
      await flush();

      const reply = thread.getState().messages[1]!;
      expect(reply.id).not.toBe('m1');
      expect(calls).toEqual([
        { threadId: thread.getState().threadId, messageId: reply.id, reason: 'error' },
      ]);
      scope.destroy();
      runtime.destroy();
    });

    it('does not report a message that is already failed when its index reaches it', async () => {
      let runs = 0;
      const failsFirst: ChatModelAdapter = {
        async *run() {
          if (runs++ === 0) throw new Error('model down');
          yield { content: [{ type: 'text', text: 'ok' }] };
        },
      };
      const runtime = runtimeInjector(failsFirst);
      const thread = await sendAndSettle(runtime); // [user, failed reply]
      const failed = thread.getState().messages[1]!.id;

      // Editing the user message starts a branch whose reply succeeds.
      const edit = thread.getMessageByIndex(0).composer;
      edit.beginEdit();
      edit.setText('edited');
      edit.send();
      await waitFor(() => !thread.getState().isRunning);
      await flush();
      expect(thread.getState().messages[1]!.status?.type).toBe('complete');

      const scope = injectorWith(
        provideMessageScope(() => thread.getMessageByIndex(1)),
        runtime,
      );
      const { calls } = listen(scope, 'message.error');

      // Going back to the first branch brings the failed reply to index 1: not a transition.
      thread.getMessageByIndex(0).switchToBranch({ position: 'previous' });
      await flush();
      expect(thread.getState().messages[1]!.id).toBe(failed);
      expect(calls).toEqual([]);
      scope.destroy();
      runtime.destroy();
    });

    it('does not report messages that were already failed when subscribing', async () => {
      const runtime = runtimeInjector(failingModel());
      await sendAndSettle(runtime);
      const { calls } = listen(runtime, { scope: 'thread', event: 'message.error' });
      const thread = runtime.runInContext(() => injectThread());
      thread.composer.setText('typing');
      await flush();

      expect(calls).toEqual([]);
      runtime.destroy();
    });
  });

  describe('threads.selectionChanged', () => {
    it('reports a switch with the previous thread, but not the thread selected at first', async () => {
      const runtime = runtimeInjector();
      const { assistant, select } = fakeAssistant(runtime);
      const injector = injectorWith(
        provideAssistantScope(() => assistant),
        runtime,
      );
      const { calls } = listen(injector, 'threads.selectionChanged');
      const everywhere = listen(injector, { scope: '*', event: 'threads.selectionChanged' });
      const first = assistant.threads.getState().mainThreadId;
      await flush();
      expect(calls).toEqual([]);

      select('t2');
      select('t2');
      select('t3');
      await flush();

      expect(calls).toEqual([
        { threadId: 't2', previousThreadId: first },
        { threadId: 't3', previousThreadId: 't2' },
      ]);
      expect(everywhere.calls).toEqual(calls);
      injector.destroy();
      runtime.destroy();
    });
  });
});
