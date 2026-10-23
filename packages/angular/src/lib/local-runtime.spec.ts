import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  InjectionToken,
  createEnvironmentInjector,
  inject,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  ChatModelAdapter,
  RealtimeVoiceAdapter,
  ThreadHistoryAdapter,
} from '@ngx-assistant/engine';
import { fromRuntime } from './from-runtime';
import { provideLocalRuntime } from './local-runtime';
import { injectAssistant, injectComposer, injectThread } from './scopes';

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

const injectorWith = (...providers: Parameters<typeof createEnvironmentInjector>[0]) =>
  createEnvironmentInjector(providers, TestBed.inject(EnvironmentInjector));

const waitFor = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true));

describe('provideLocalRuntime', () => {
  it('provides a runtime with its thread and composer scopes', () => {
    const injector = injectorWith(provideLocalRuntime(replyModel()));
    const assistant = injector.runInContext(() => injectAssistant());

    expect(injector.runInContext(() => injectAssistant())).toBe(assistant);
    expect(injector.runInContext(() => injectThread())).toBe(assistant.thread);
    expect(injector.runInContext(() => injectComposer())).toBe(assistant.thread.composer);
    injector.destroy();
  });

  it('runs the chat model and streams the reply into signals', async () => {
    const injector = injectorWith(provideLocalRuntime(replyModel('hi there')));
    const thread = injector.runInContext(() => injectThread());
    const messages = fromRuntime(thread, (s) => s.messages, { injector });
    const isRunning = fromRuntime(thread, (s) => s.isRunning, { injector });

    thread.composer.setText('ping');
    thread.composer.send();

    await waitFor(() => messages().length === 2 && !isRunning());
    expect(messages().map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages()[1]!.content).toEqual([{ type: 'text', text: 'hi there' }]);
    injector.destroy();
  });

  it('starts from the initial messages', () => {
    const injector = injectorWith(
      provideLocalRuntime(replyModel(), {
        initialMessages: [{ id: 'm0', role: 'user', content: 'earlier' }],
      }),
    );
    const thread = injector.runInContext(() => injectThread());

    expect(thread.getState().messages.map((m) => m.id)).toEqual(['m0']);
    injector.destroy();
  });

  it('aborts the running stream when the injector is destroyed', async () => {
    const { model, signals } = blockingModel();
    const injector = injectorWith(provideLocalRuntime(model));
    const thread = injector.runInContext(() => injectThread());

    thread.composer.setText('ping');
    thread.composer.send();
    await waitFor(() => signals.length === 1 && thread.getState().isRunning);
    expect(signals[0]!.aborted).toBe(false);

    injector.destroy();
    expect(signals[0]!.aborted).toBe(true);
  });

  it('aborts the running stream when the providing component is destroyed', async () => {
    const { model, signals } = blockingModel();

    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      providers: [provideLocalRuntime(model)],
      template: `<p>{{ isRunning() ? 'running' : 'idle' }}</p>`,
    })
    class Host {
      readonly thread = injectThread();
      readonly isRunning = fromRuntime(this.thread, (s) => s.isRunning);
    }

    const fixture = TestBed.createComponent(Host);
    const text = () => (fixture.nativeElement as HTMLElement).textContent;
    await fixture.whenStable();
    expect(text()).toBe('idle');

    fixture.componentInstance.thread.composer.setText('ping');
    fixture.componentInstance.thread.composer.send();
    await waitFor(() => signals.length === 1);
    await fixture.whenStable();
    expect(text()).toBe('running');

    fixture.destroy();
    expect(signals[0]!.aborted).toBe(true);
  });

  it('runs chatModel and options factories in the injection context', async () => {
    const REPLY = new InjectionToken<string>('REPLY');
    const HISTORY = new InjectionToken<ThreadHistoryAdapter>('HISTORY');
    const load = vi.fn<ThreadHistoryAdapter['load']>(async () => ({ messages: [] }));
    const injector = injectorWith(
      { provide: REPLY, useValue: 'from di' },
      { provide: HISTORY, useValue: { load, append: () => Promise.resolve() } },
      provideLocalRuntime(
        () => replyModel(inject(REPLY)),
        () => ({ adapters: { history: inject(HISTORY) } }),
      ),
    );
    const thread = injector.runInContext(() => injectThread());
    await waitFor(() => load.mock.calls.length === 1);

    thread.composer.setText('ping');
    thread.composer.send();
    await waitFor(() => thread.getState().messages.length === 2 && !thread.getState().isRunning);
    expect(thread.getState().messages[1]!.content).toEqual([{ type: 'text', text: 'from di' }]);
    injector.destroy();
  });

  it('creates nothing until the runtime is first injected', () => {
    const chatModel = vi.fn(() => replyModel());
    const injector = injectorWith(provideLocalRuntime(chatModel));
    expect(chatModel).not.toHaveBeenCalled();

    injector.runInContext(() => injectThread());
    expect(chatModel).toHaveBeenCalledTimes(1);
    injector.destroy();
  });

  it('logs a failed history load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('offline');
    const injector = injectorWith(
      provideLocalRuntime(replyModel(), {
        adapters: {
          history: { load: () => Promise.reject(failure), append: () => Promise.resolve() },
        },
      }),
    );
    injector.runInContext(() => injectThread());

    await waitFor(() => error.mock.calls.length > 0);
    expect(error).toHaveBeenCalledWith(
      '[ngx-assistant] local thread history load failed:',
      failure,
    );
    error.mockRestore();
    injector.destroy();
  });

  it('disconnects voice when the injector is destroyed', async () => {
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
    const injector = injectorWith(
      provideLocalRuntime(replyModel(), { adapters: { voice: { connect: () => session } } }),
    );
    const thread = injector.runInContext(() => injectThread());

    thread.connectVoice();
    await waitFor(() => thread.getState().voice !== undefined);
    expect(disconnect).not.toHaveBeenCalled();

    injector.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
