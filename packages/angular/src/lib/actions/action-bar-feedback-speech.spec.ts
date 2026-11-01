import {
  ChangeDetectionStrategy,
  Component,
  ErrorHandler,
  Provider,
  computed,
  signal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  ChatModelAdapter,
  ExternalStoreAdapter,
  FeedbackAdapter,
  SpeechSynthesisAdapter,
  ThreadMessageLike,
} from '@ngx-assistant/engine';
import { provideExternalStoreRuntime } from '../external-store-runtime';
import { provideLocalRuntime } from '../local-runtime';
import { NxaMessageIf } from '../messages/message-if';
import { NxaMessageRoot } from '../messages/message-root';
import { NxaMessages } from '../messages/messages';
import { injectThread } from '../scopes';
import { NxaActionBarExportMarkdown, type NxaExportMarkdown } from './action-bar-export-markdown';
import { NxaActionBarFeedbackNegative, NxaActionBarFeedbackPositive } from './action-bar-feedback';
import { NxaActionBarSpeak, NxaActionBarStopSpeaking } from './action-bar-speak';

const text = (id: string, value: string, role: ThreadMessageLike['role'] = 'user') =>
  ({ id, role, content: [{ type: 'text', text: value }] }) satisfies ThreadMessageLike;

const assistant = (
  id: string,
  content: ThreadMessageLike['content'],
  extra: Partial<ThreadMessageLike> = {},
): ThreadMessageLike => ({
  id,
  role: 'assistant',
  content,
  status: { type: 'complete', reason: 'stop' },
  ...extra,
});

const seeded: ThreadMessageLike[] = [
  text('u1', 'hello'),
  assistant('a1', [{ type: 'text', text: '# Echo\n\nhello' }]),
];

const model: ChatModelAdapter = {
  async *run() {
    yield { content: [{ type: 'text', text: 'again' }] };
  },
};

const click = (target: Element) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  target.dispatchEvent(event);
  return event;
};

/** A speech adapter whose utterances run until they are finished or cancelled. */
function fakeSpeech() {
  const utterances: (SpeechSynthesisAdapter.Utterance & { text: string; finish(): void })[] = [];
  const adapter: SpeechSynthesisAdapter = {
    speak: vi.fn((value: string) => {
      const listeners = new Set<() => void>();
      const end = (reason: 'finished' | 'cancelled') => {
        utterance.status = { type: 'ended', reason };
        for (const listener of [...listeners]) listener();
      };
      const utterance = {
        text: value,
        status: { type: 'running' } as SpeechSynthesisAdapter.Status,
        cancel: vi.fn(() => end('cancelled')),
        finish: () => end('finished'),
        subscribe: (callback: () => void) => {
          listeners.add(callback);
          return () => listeners.delete(callback);
        },
      };
      utterances.push(utterance);
      return utterance;
    }),
  };
  return { adapter, utterances };
}

/** An external store whose messages and run state are signals. */
function createStore(
  initial: readonly ThreadMessageLike[],
  adapters: ExternalStoreAdapter<ThreadMessageLike>['adapters'] = {},
) {
  const messages = signal<readonly ThreadMessageLike[]>(initial);
  const isRunning = signal(false);
  const provider = provideExternalStoreRuntime<ThreadMessageLike>(() =>
    computed((): ExternalStoreAdapter<ThreadMessageLike> => ({
      messages: messages(),
      isRunning: isRunning(),
      convertMessage: (message) => message,
      onNew: async () => undefined,
      adapters,
    })),
  );
  return { messages, isRunning, provider };
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaMessages,
    NxaMessageRoot,
    NxaMessageIf,
    NxaActionBarFeedbackPositive,
    NxaActionBarFeedbackNegative,
    NxaActionBarSpeak,
    NxaActionBarStopSpeaking,
    NxaActionBarExportMarkdown,
  ],
  template: `
    <article *nxaMessages="let message" nxaMessageRoot class="msg" [attr.data-id]="message().id">
      <button nxaActionBarFeedbackPositive class="up" [disabled]="disabled()">Up</button>
      <button nxaActionBarFeedbackNegative class="down" [disabled]="disabled()">Down</button>
      <button nxaActionBarSpeak class="speak" [disabled]="disabled()">Speak</button>
      <button nxaActionBarStopSpeaking class="stop" [disabled]="disabled()">Stop</button>
      <span *nxaMessageIf="{ speaking: true }" class="speaking">speaking</span>
      <button
        nxaActionBarExportMarkdown
        class="export"
        [filename]="filename()"
        [exportMarkdown]="exporter()"
        [disabled]="disabled()"
      >
        Export
      </button>
    </article>
  `,
})
class Chat {
  readonly thread = injectThread();
  readonly disabled = signal(false);
  readonly filename = signal<string | undefined>(undefined);
  readonly exporter = signal<NxaExportMarkdown | undefined>(undefined);
}

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await fixture.whenStable();
}

/** Errors Angular caught, from listeners among others; every case expects none. */
let caught: unknown[] = [];

async function mount(providers: Provider[]) {
  TestBed.configureTestingModule({
    providers: [
      ...providers,
      { provide: ErrorHandler, useValue: { handleError: (error: unknown) => caught.push(error) } },
    ],
  });
  const fixture = TestBed.createComponent(Chat);
  document.body.append(fixture.nativeElement);
  fixture.detectChanges();
  await settle(fixture);
  return fixture;
}

const until = (fixture: ComponentFixture<unknown>, check: () => void) =>
  vi.waitFor(async () => {
    await fixture.whenStable();
    check();
  });

const message = (fixture: ComponentFixture<unknown>, id: string) =>
  (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`article[data-id="${id}"]`)!;
const button = (scope: HTMLElement, selector: string) =>
  scope.querySelector<HTMLButtonElement>(selector)!;

const vetoClicks = (fixture: ComponentFixture<unknown>) =>
  (fixture.nativeElement as HTMLElement).addEventListener(
    'click',
    (event) => event.preventDefault(),
    { capture: true },
  );

beforeEach(() => {
  caught = [];
});

afterEach(() => {
  expect(caught).toEqual([]);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('nxaActionBarFeedbackPositive / nxaActionBarFeedbackNegative', () => {
  it.each([
    [undefined, 'false', 'false'],
    [{ type: 'positive' as const }, 'true', 'false'],
    [{ type: 'negative' as const }, 'false', 'true'],
  ])('exposes the submitted state for %s', async (submittedFeedback, up, down) => {
    const store = createStore([
      assistant('a1', [{ type: 'text', text: 'hi' }], { metadata: { submittedFeedback } }),
    ]);
    const fixture = await mount([store.provider]);
    const scope = message(fixture, 'a1');

    expect(button(scope, '.up').getAttribute('aria-pressed')).toBe(up);
    expect(button(scope, '.down').getAttribute('aria-pressed')).toBe(down);
    expect(button(scope, '.up').hasAttribute('data-nxa-submitted')).toBe(up === 'true');
    expect(button(scope, '.down').hasAttribute('data-nxa-submitted')).toBe(down === 'true');
    expect(button(scope, '.up').type).toBe('button');
  });

  it('submits the feedback through the adapter and follows the submitted state', async () => {
    const submit = vi.fn<FeedbackAdapter['submit']>();
    const fixture = await mount(
      provideLocalRuntime(model, { initialMessages: seeded, adapters: { feedback: { submit } } }),
    );
    const scope = message(fixture, 'a1');

    click(button(scope, '.up'));
    await settle(fixture);
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]![0]).toMatchObject({ type: 'positive', message: { id: 'a1' } });
    expect(button(scope, '.up').getAttribute('aria-pressed')).toBe('true');
    expect(button(scope, '.down').getAttribute('aria-pressed')).toBe('false');

    click(button(scope, '.down'));
    await settle(fixture);
    expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'negative' }));
    expect(button(scope, '.up').hasAttribute('data-nxa-submitted')).toBe(false);
    expect(button(scope, '.down').hasAttribute('data-nxa-submitted')).toBe(true);
  });

  it('records the feedback on the message without a feedback adapter', async () => {
    const fixture = await mount(provideLocalRuntime(model, { initialMessages: seeded }));
    const scope = message(fixture, 'a1');
    expect(button(scope, '.up').disabled).toBe(false);

    click(button(scope, '.up'));
    await settle(fixture);

    expect(fixture.componentInstance.thread.getMessageById('a1').getState().metadata).toMatchObject(
      { submittedFeedback: { type: 'positive' } },
    );
    expect(button(scope, '.up').getAttribute('aria-pressed')).toBe('true');
  });

  it('does nothing when vetoed or disabled', async () => {
    const submit = vi.fn<FeedbackAdapter['submit']>();
    const fixture = await mount(
      provideLocalRuntime(model, { initialMessages: seeded, adapters: { feedback: { submit } } }),
    );
    const scope = message(fixture, 'a1');

    fixture.componentInstance.disabled.set(true);
    await settle(fixture);
    expect(button(scope, '.up').disabled).toBe(true);
    click(button(scope, '.up'));

    fixture.componentInstance.disabled.set(false);
    await settle(fixture);
    vetoClicks(fixture);
    click(button(scope, '.down'));
    await settle(fixture);

    expect(submit).not.toHaveBeenCalled();
    expect(button(scope, '.down').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('nxaActionBarSpeak / nxaActionBarStopSpeaking', () => {
  it('is disabled when the runtime has no speech adapter', async () => {
    const fixture = await mount(provideLocalRuntime(model, { initialMessages: seeded }));
    expect(button(message(fixture, 'a1'), '.speak').disabled).toBe(true);
  });

  it('is disabled while the message runs or has no text', async () => {
    const { adapter } = fakeSpeech();
    const store = createStore(
      [
        text('u1', 'hello'),
        assistant('a1', [], {}),
        assistant('a2', [{ type: 'text', text: 'partial' }], { status: { type: 'running' } }),
      ],
      { speech: adapter },
    );
    store.isRunning.set(true);
    const fixture = await mount([store.provider]);

    expect(button(message(fixture, 'u1'), '.speak').disabled).toBe(false);
    expect(button(message(fixture, 'a1'), '.speak').disabled).toBe(true);
    expect(button(message(fixture, 'a2'), '.speak').disabled).toBe(true);
  });

  it('reads the message aloud and stops it, for that message only', async () => {
    const speech = fakeSpeech();
    const fixture = await mount(
      provideLocalRuntime(model, { initialMessages: seeded, adapters: { speech: speech.adapter } }),
    );
    const user = message(fixture, 'u1');
    const reply = message(fixture, 'a1');
    expect(button(reply, '.speak').disabled).toBe(false);
    expect(button(reply, '.stop').disabled).toBe(true);

    click(button(reply, '.speak'));
    await settle(fixture);

    expect(speech.adapter.speak).toHaveBeenCalledWith('# Echo\n\nhello');
    expect(reply.querySelector('.speaking')).not.toBeNull();
    expect(button(reply, '.stop').disabled).toBe(false);
    expect(button(user, '.stop').disabled).toBe(true);

    click(button(user, '.stop'));
    expect(speech.utterances[0]!.cancel).not.toHaveBeenCalled();

    click(button(reply, '.stop'));
    await settle(fixture);
    expect(speech.utterances[0]!.cancel).toHaveBeenCalledOnce();
    expect(reply.querySelector('.speaking')).toBeNull();
    expect(button(reply, '.stop').disabled).toBe(true);
  });

  it('moves the reading to another message and follows an utterance that ends', async () => {
    const speech = fakeSpeech();
    const fixture = await mount(
      provideLocalRuntime(model, { initialMessages: seeded, adapters: { speech: speech.adapter } }),
    );
    const user = message(fixture, 'u1');
    const reply = message(fixture, 'a1');

    click(button(reply, '.speak'));
    await settle(fixture);
    click(button(user, '.speak'));
    await settle(fixture);

    expect(speech.utterances[0]!.cancel).toHaveBeenCalledOnce();
    expect(button(reply, '.stop').disabled).toBe(true);
    expect(button(user, '.stop').disabled).toBe(false);

    speech.utterances[1]!.finish();
    await until(fixture, () => expect(button(user, '.stop').disabled).toBe(true));
    expect(user.querySelector('.speaking')).toBeNull();
  });

  it('does nothing when vetoed', async () => {
    const speech = fakeSpeech();
    const fixture = await mount(
      provideLocalRuntime(model, { initialMessages: seeded, adapters: { speech: speech.adapter } }),
    );
    vetoClicks(fixture);
    click(button(message(fixture, 'a1'), '.speak'));
    await settle(fixture);
    expect(speech.adapter.speak).not.toHaveBeenCalled();
  });

  it('ignores a stop that reaches it after the reading has ended', async () => {
    const speech = fakeSpeech();
    const fixture = await mount(
      provideLocalRuntime(model, { initialMessages: seeded, adapters: { speech: speech.adapter } }),
    );
    const reply = message(fixture, 'a1');
    click(button(reply, '.speak'));
    await settle(fixture);
    const stop = button(reply, '.stop');
    expect(stop.disabled).toBe(false);

    // The utterance ends; the click arrives before the button re-renders.
    speech.utterances[0]!.finish();
    expect(() => click(stop)).not.toThrow();
    expect(speech.utterances[0]!.cancel).not.toHaveBeenCalled();
  });
});

describe('nxaActionBarExportMarkdown', () => {
  function stubDownload() {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:markdown');
    const revokeObjectURL = vi.fn();
    // A subclass, so the real `URL` is left as it was.
    vi.stubGlobal(
      'URL',
      class extends URL {
        static override createObjectURL = createObjectURL;
        static override revokeObjectURL = revokeObjectURL;
      },
    );
    const anchors: { href: string; download: string; rel: string; attached: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchors.push({
        href: this.href,
        download: this.download,
        rel: this.rel,
        attached: document.body.contains(this),
      });
    });
    return { createObjectURL, revokeObjectURL, anchors };
  }

  it('clicks a download anchor that is attached to the document', async () => {
    const download = stubDownload();
    const fixture = await mount(provideLocalRuntime(model, { initialMessages: seeded }));
    fixture.componentInstance.filename.set('answer.md');
    await settle(fixture);
    vi.useFakeTimers();

    click(button(message(fixture, 'a1'), '.export'));

    expect(download.anchors).toEqual([
      { href: 'blob:markdown', download: 'answer.md', rel: 'noopener', attached: true },
    ]);
    expect(document.querySelector('a[download]')).toBeNull();
    const blob = download.createObjectURL.mock.calls[0]![0];
    expect(blob.type).toBe('text/markdown');
    await expect(blob.text()).resolves.toBe('# Echo\n\nhello');

    vi.advanceTimersByTime(39_999);
    expect(download.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(download.revokeObjectURL).toHaveBeenCalledWith('blob:markdown');
  });

  it('names the file after the time of the export by default', async () => {
    const download = stubDownload();
    const fixture = await mount(provideLocalRuntime(model, { initialMessages: seeded }));
    click(button(message(fixture, 'a1'), '.export'));
    expect(download.anchors[0]!.download).toMatch(/^message-\d+\.md$/);
  });

  it('hands the text to exportMarkdown instead of downloading it', async () => {
    const download = stubDownload();
    const exporter = vi.fn<NxaExportMarkdown>();
    const fixture = await mount(provideLocalRuntime(model, { initialMessages: seeded }));
    fixture.componentInstance.exporter.set(exporter);
    await settle(fixture);

    click(button(message(fixture, 'a1'), '.export'));
    await settle(fixture);

    expect(exporter).toHaveBeenCalledWith('# Echo\n\nhello');
    expect(download.anchors).toEqual([]);
  });

  it('handles rejected and throwing exports', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = await mount(provideLocalRuntime(model, { initialMessages: seeded }));
    const failure = new Error('disk full');
    fixture.componentInstance.exporter.set(() => Promise.reject(failure));
    await settle(fixture);
    click(button(message(fixture, 'a1'), '.export'));
    await until(fixture, () => expect(error).toHaveBeenCalledWith(expect.any(String), failure));

    const thrown = new Error('sync');
    fixture.componentInstance.exporter.set(() => {
      throw thrown;
    });
    await settle(fixture);
    expect(() => click(button(message(fixture, 'a1'), '.export'))).not.toThrow();
    await until(fixture, () => expect(error).toHaveBeenCalledWith(expect.any(String), thrown));
  });

  it('is disabled while the message runs or has no text, and does nothing when vetoed', async () => {
    const store = createStore([
      text('u1', 'hello'),
      assistant('a1', []),
      assistant('a2', [{ type: 'text', text: 'partial' }], { status: { type: 'running' } }),
    ]);
    store.isRunning.set(true);
    const exporter = vi.fn<NxaExportMarkdown>();
    const fixture = await mount([store.provider]);
    fixture.componentInstance.exporter.set(exporter);
    await settle(fixture);

    expect(button(message(fixture, 'a1'), '.export').disabled).toBe(true);
    expect(button(message(fixture, 'a2'), '.export').disabled).toBe(true);
    expect(button(message(fixture, 'u1'), '.export').disabled).toBe(false);

    vetoClicks(fixture);
    click(button(message(fixture, 'u1'), '.export'));
    await settle(fixture);
    expect(exporter).not.toHaveBeenCalled();
  });
});
