import { ChangeDetectionStrategy, Component, Type, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  ChatModelAdapter,
  SpeechSynthesisAdapter,
  ThreadMessageLike,
  ThreadRuntime,
} from '@ngx-assistant/engine';
import { NxaComposerInput } from '../composer/composer-input';
import { provideLocalRuntime } from '../local-runtime';
import { injectThread } from '../scopes';
import { NxaThreadRoot } from './thread-root';

const replyModel = (): ChatModelAdapter => ({
  async *run() {
    yield { content: [{ type: 'text', text: 'reply' }] };
  },
});

const waitForAbortModel = (): ChatModelAdapter => ({
  async *run({ abortSignal }) {
    await new Promise<void>((resolve) => {
      if (abortSignal.aborted) resolve();
      else abortSignal.addEventListener('abort', () => resolve(), { once: true });
    });
    yield { content: [] };
  },
});

const initialMessages: ThreadMessageLike[] = [
  {
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello' }],
    status: { type: 'complete', reason: 'stop' },
  },
];

const createSpeech = () => {
  const cancel = vi.fn();
  const subscribers = new Set<() => void>();
  const utterance: SpeechSynthesisAdapter.Utterance = {
    status: { type: 'running' },
    cancel,
    subscribe: (callback) => {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
  };
  const adapter: SpeechSynthesisAdapter = { speak: vi.fn(() => utterance) };
  const finish = () => {
    utterance.status = { type: 'ended', reason: 'finished' };
    for (const subscriber of subscribers) subscriber();
  };
  return { adapter, cancel, finish };
};

const waitFor = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true));

const escape = (target: EventTarget, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

const show = {
  control: signal(true),
  composer: signal(false),
};

/** A thread with its own runtime, rendered with `nxaThreadRoot`. */
const threadHost = (speech: SpeechSynthesisAdapter, chatModel = replyModel()) => {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NxaThreadRoot, NxaComposerInput],
    providers: [provideLocalRuntime(chatModel, { initialMessages, adapters: { speech } })],
    template: `
      <div nxaThreadRoot data-testid="root">
        @if (show.control()) {
          <button data-testid="control">Speak</button>
        }
        @if (show.composer()) {
          <textarea nxaComposerInput data-testid="composer"></textarea>
        }
      </div>
    `,
  })
  class ThreadHost {
    readonly show = show;
    readonly thread = injectThread();
  }
  return ThreadHost;
};

const render = async <T>(host: Type<T>) => {
  const fixture = TestBed.createComponent(host);
  await fixture.whenStable();
  return fixture;
};

const query = (fixture: ComponentFixture<unknown>, testId: string) =>
  (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;

const startSpeaking = async (fixture: ComponentFixture<{ thread: ThreadRuntime }>) => {
  const { thread } = fixture.componentInstance;
  thread.getMessageByIndex(0).speak();
  await waitFor(() => thread.getState().speech !== undefined);
};

describe('nxaThreadRoot', () => {
  beforeEach(() => {
    show.control.set(true);
    show.composer.set(false);
  });

  it('marks the thread root for the composer focus rules', async () => {
    const fixture = await render(threadHost(createSpeech().adapter));
    expect(query(fixture, 'root').getAttribute('data-nxa-thread-root')).toBe('');
  });

  it('stops active speech after the initiating control is removed', async () => {
    const speech = createSpeech();
    const fixture = await render(threadHost(speech.adapter));
    query(fixture, 'control').focus();
    await startSpeaking(fixture);

    show.control.set(false);
    await fixture.whenStable();
    const event = escape(document.body);

    expect(speech.cancel).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not consume Escape when no speech is active', async () => {
    const speech = createSpeech();
    const fixture = await render(threadHost(speech.adapter));

    const event = escape(query(fixture, 'control'));

    expect(speech.cancel).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores an Escape that something else already handled', async () => {
    const speech = createSpeech();
    const fixture = await render(threadHost(speech.adapter));
    await startSpeaking(fixture);
    const control = query(fixture, 'control');
    control.addEventListener('keydown', (event) => event.preventDefault());

    escape(control);

    expect(speech.cancel).not.toHaveBeenCalled();
  });

  it('does not stop speech in another mounted thread', async () => {
    const first = createSpeech();
    const second = createSpeech();
    const firstFixture = await render(threadHost(first.adapter));
    const secondFixture = await render(threadHost(second.adapter));
    await startSpeaking(firstFixture);

    const event = escape(query(secondFixture, 'control'));

    expect(first.cancel).not.toHaveBeenCalled();
    expect(second.cancel).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('stops speech in the thread containing the Escape target', async () => {
    const first = createSpeech();
    const second = createSpeech();
    const firstFixture = await render(threadHost(first.adapter));
    const secondFixture = await render(threadHost(second.adapter));
    await startSpeaking(firstFixture);
    await startSpeaking(secondFixture);

    const event = escape(query(secondFixture, 'control'));

    expect(first.cancel).not.toHaveBeenCalled();
    expect(second.cancel).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('stops speech in a thread mounted inside a closed shadow root', async () => {
    const first = createSpeech();
    const second = createSpeech();
    const firstFixture = await render(threadHost(first.adapter));
    const secondFixture = await render(threadHost(second.adapter));
    const shadowHost = document.createElement('div');
    const shadowRoot = shadowHost.attachShadow({ mode: 'closed' });
    shadowRoot.append(secondFixture.nativeElement as HTMLElement);
    document.body.append(shadowHost);

    try {
      await startSpeaking(firstFixture);
      await startSpeaking(secondFixture);

      const event = escape(query(secondFixture, 'control'));

      expect(first.cancel).not.toHaveBeenCalled();
      expect(second.cancel).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    } finally {
      shadowHost.remove();
    }
  });

  it('stops speech from outside the only mounted thread', async () => {
    const speech = createSpeech();
    const fixture = await render(threadHost(speech.adapter));
    await startSpeaking(fixture);
    const outside = document.createElement('button');
    document.body.append(outside);

    try {
      const event = escape(outside);

      expect(speech.cancel).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    } finally {
      outside.remove();
    }
  });

  it('does nothing once the speech has ended', async () => {
    const speech = createSpeech();
    const fixture = await render(threadHost(speech.adapter));
    await startSpeaking(fixture);

    speech.finish();
    const event = escape(document.body);

    expect(speech.cancel).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores speech that ended between the state read and the stop', async () => {
    const speech = createSpeech();
    const fixture = await render(threadHost(speech.adapter));
    const { thread } = fixture.componentInstance;
    // The state still reports speech that the thread no longer has.
    vi.spyOn(thread, 'getState').mockReturnValue({
      ...thread.getState(),
      speech: { messageId: 'gone', status: { type: 'running' } },
    });

    // A listener that throws is reported to the window, not to the dispatcher.
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      escape(document.body);
    } finally {
      window.removeEventListener('error', onError);
    }

    expect(errors).toEqual([]);
    expect(speech.cancel).not.toHaveBeenCalled();
  });

  it('removes its document listener when destroyed', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const fixture = await render(threadHost(createSpeech().adapter));
    const listener = add.mock.calls.find(([type]) => type === 'keydown')?.[1];
    expect(listener).toBeDefined();

    fixture.destroy();

    expect(remove).toHaveBeenCalledWith('keydown', listener);
    add.mockRestore();
    remove.mockRestore();
  });

  it('lets a composer consume Escape first', async () => {
    const speech = createSpeech();
    show.control.set(false);
    const fixture = await render(threadHost(speech.adapter, waitForAbortModel()));
    const { thread } = fixture.componentInstance;
    await startSpeaking(fixture);
    thread.append('Run');
    await waitFor(() => thread.getState().isRunning);

    show.composer.set(true);
    await fixture.whenStable();
    const event = escape(query(fixture, 'composer'));

    await waitFor(() => !thread.getState().isRunning);
    expect(speech.cancel).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ['during the composition', { isComposing: true }],
    ['after compositionend (Safari)', { keyCode: 229 }],
  ])('keeps speech playing when Escape ends an IME composition %s', async (_, init) => {
    const speech = createSpeech();
    show.composer.set(true);
    const fixture = await render(threadHost(speech.adapter));
    await startSpeaking(fixture);

    const event = escape(query(fixture, 'composer'), init);

    expect(speech.cancel).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('lets an idle composer fall through so Escape still stops speech', async () => {
    const speech = createSpeech();
    show.composer.set(true);
    const fixture = await render(threadHost(speech.adapter));
    await startSpeaking(fixture);

    const event = escape(query(fixture, 'composer'));

    expect(speech.cancel).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.thread.getState().isRunning).toBe(false);
  });
});
