import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  Provider,
  Type,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  ComposerRuntime,
  ExternalStoreAdapter,
  ThreadMessageLike,
  ThreadRuntime,
  ThreadState,
  ThreadSuggestion,
} from '@ngx-assistant/engine';
import { provideExternalStoreRuntime } from '../external-store-runtime';
import {
  NXA_ASSISTANT,
  NXA_COMPOSER,
  NXA_THREAD,
  injectComposer,
  injectSuggestion,
  injectThread,
  provideSuggestionScope,
} from '../scopes';
import { NxaSuggestionDescription, NxaSuggestionTitle } from './suggestion-text';
import { NxaSuggestionTrigger, suggestionSendMode } from './suggestion-trigger';
import {
  NxaSuggestions,
  getSuggestionKeys,
  provideSuggestions,
  type SuggestionConfig,
} from './suggestions';

const click = (target: Element) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  target.dispatchEvent(event);
  return event;
};

/** An external store whose suggestions are a signal, and whose sends land in `onNew`. */
function createStore(initial: readonly ThreadSuggestion[] = []) {
  const suggestions = signal<readonly ThreadSuggestion[]>(initial);
  const messages = signal<readonly ThreadMessageLike[]>([]);
  const onNew = vi.fn(async (message: { content: readonly unknown[]; runConfig?: unknown }) => {
    messages.update((list) => [
      ...list,
      {
        id: `m${list.length}`,
        role: 'user',
        content: message.content as ThreadMessageLike['content'],
      },
    ]);
  });
  const provider = provideExternalStoreRuntime<ThreadMessageLike>(() =>
    computed((): ExternalStoreAdapter<ThreadMessageLike> => ({
      messages: messages(),
      suggestions: suggestions(),
      convertMessage: (message) => message,
      onNew,
    })),
  );
  return { suggestions, messages, onNew, provider };
}

/** Stamps each row with the prompt it was created with, to tell a reused row from a new one. */
@Component({ selector: 'nxa-test-initial', template: '{{ initial }}' })
class InitialPrompt {
  readonly initial = injectSuggestion().getState().prompt;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaSuggestions, NxaSuggestionTitle, NxaSuggestionDescription, InitialPrompt],
  template: `
    <div *nxaSuggestions="let suggestion; let i = index" class="row" [attr.data-index]="i">
      <span nxaSuggestionTitle class="title"></span>
      <span nxaSuggestionDescription class="label"></span>
      <span class="prompt">{{ suggestion().prompt }}</span>
      <nxa-test-initial class="initial" />
    </div>
  `,
})
class List {}

async function mount<T>(providers: Provider[], component: Type<T>) {
  TestBed.configureTestingModule({ providers });
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

const until = (fixture: ComponentFixture<unknown>, check: () => void) =>
  vi.waitFor(async () => {
    await fixture.whenStable();
    check();
  });

const texts = (fixture: ComponentFixture<unknown>, selector: string) =>
  Array.from((fixture.nativeElement as HTMLElement).querySelectorAll(selector)).map(
    (element) => element.textContent,
  );
const rows = (fixture: ComponentFixture<unknown>) =>
  Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.row'));

const suggestion = (prompt: string): ThreadSuggestion => ({ title: prompt, label: prompt, prompt });

describe('*nxaSuggestions', () => {
  it("renders the thread's suggestions, the title falling back to the prompt", async () => {
    const store = createStore([
      { prompt: 'Plain prompt' },
      { title: 'Weather', label: 'in Rome', prompt: 'What is the weather in Rome?' },
    ]);
    const fixture = await mount([store.provider], List);

    expect(texts(fixture, '.title')).toEqual(['Plain prompt', 'Weather']);
    expect(texts(fixture, '.label')).toEqual(['', 'in Rome']);
    expect(texts(fixture, '.prompt')).toEqual(['Plain prompt', 'What is the weather in Rome?']);
  });

  it('does not reuse a row for a different suggestion', async () => {
    const store = createStore([suggestion('first prompt'), suggestion('second')]);
    const fixture = await mount([store.provider], List);

    store.suggestions.set([store.suggestions()[1]!]);
    await until(fixture, () => expect(texts(fixture, '.initial')).toEqual(['second']));
  });

  it("keeps a surviving suggestion's row when an earlier one is removed", async () => {
    const store = createStore([suggestion('alpha'), suggestion('beta'), suggestion('gamma')]);
    const fixture = await mount([store.provider], List);
    const gamma = rows(fixture)[2]!;

    store.suggestions.set([store.suggestions()[0]!, store.suggestions()[2]!]);
    await until(fixture, () => expect(texts(fixture, '.initial')).toEqual(['alpha', 'gamma']));
    expect(rows(fixture)[1]).toBe(gamma);
    expect(gamma.dataset['index']).toBe('1');
  });

  it('moves the rows with reordered suggestions', async () => {
    const store = createStore([suggestion('a'), suggestion('b'), suggestion('c')]);
    const fixture = await mount([store.provider], List);
    const [a, b, c] = rows(fixture);

    store.suggestions.set([suggestion('c'), suggestion('a'), suggestion('b')]);
    await until(fixture, () => expect(texts(fixture, '.initial')).toEqual(['c', 'a', 'b']));
    expect(rows(fixture)).toEqual([c, a, b]);
  });

  it('renders suggestions that share a prompt in a row each', async () => {
    const store = createStore([suggestion('same'), suggestion('same')]);
    const fixture = await mount([store.provider], List);
    expect(texts(fixture, '.prompt')).toEqual(['same', 'same']);
  });

  it('keeps every row when equal suggestions arrive as new objects', async () => {
    const store = createStore([suggestion('a'), suggestion('b')]);
    const fixture = await mount([store.provider], List);
    const before = rows(fixture);

    store.suggestions.set([suggestion('a'), suggestion('b')]);
    await fixture.whenStable();
    expect(rows(fixture)).toEqual(before);
  });

  it('drops the holes of a sparse list', async () => {
    // eslint-disable-next-line no-sparse-arrays
    const sparse = [suggestion('a'), , suggestion('b')] as ThreadSuggestion[];
    const store = createStore(sparse);
    const fixture = await mount([store.provider], List);
    expect(texts(fixture, '.prompt')).toEqual(['a', 'b']);
  });

  it('renders the provided suggestions in place of the thread ones', async () => {
    const store = createStore([suggestion('from the runtime')]);
    const fixture = await mount(
      [
        store.provider,
        provideSuggestions([
          'Hello',
          { title: 'Tell me', label: 'a joke', prompt: 'Tell me a joke' },
        ]),
      ],
      List,
    );

    expect(texts(fixture, '.title')).toEqual(['Hello', 'Tell me']);
    expect(texts(fixture, '.label')).toEqual(['', 'a joke']);
    expect(texts(fixture, '.prompt')).toEqual(['Hello', 'Tell me a joke']);
  });

  it('follows a signal of provided suggestions, keeping the rows that stay', async () => {
    const configured = signal<readonly SuggestionConfig[]>(['a', 'b']);
    const fixture = await mount([createStore().provider, provideSuggestions(configured)], List);
    const b = rows(fixture)[1]!;

    configured.set(['b', 'c']);
    await until(fixture, () => {
      fixture.detectChanges();
      expect(texts(fixture, '.prompt')).toEqual(['b', 'c']);
    });
    expect(rows(fixture)[0]).toBe(b);
  });
});

describe('provided suggestions and nested runtimes', () => {
  @Component({
    selector: 'nxa-test-inner',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NxaSuggestions],
    providers: [
      provideExternalStoreRuntime<ThreadMessageLike>({
        messages: [],
        suggestions: [{ prompt: 'inner' }],
        convertMessage: (message) => message,
        onNew: async () => undefined,
      }),
    ],
    template: `<i *nxaSuggestions="let suggestion" class="inner">{{ suggestion().prompt }}</i>`,
  })
  class Inner {}

  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NxaSuggestions, Inner],
    template: `
      <i *nxaSuggestions="let suggestion" class="outer">{{ suggestion().prompt }}</i>
      <nxa-test-inner />
    `,
  })
  class Outer {}

  it('belong to their runtime: a nested runtime shows its own thread suggestions', async () => {
    const store = createStore([suggestion('outer thread')]);
    const fixture = await mount([store.provider, provideSuggestions(['provided'])], Outer);
    expect(texts(fixture, '.outer')).toEqual(['provided']);
    expect(texts(fixture, '.inner')).toEqual(['inner']);
  });

  it('apply to a runtime provided below them', async () => {
    const fixture = await mount([provideSuggestions(['provided'])], Inner);
    expect(texts(fixture, '.inner')).toEqual(['provided']);
  });
});

describe('getSuggestionKeys', () => {
  it('keys by content and counts repeats', () => {
    const a = { title: 'a', label: '', prompt: 'a' };
    const b = { title: 'b', label: '', prompt: 'b' };
    const keys = getSuggestionKeys([a, b, a, a]);
    expect(new Set(keys).size).toBe(4);
    expect(keys[2]).toBe(`${keys[0]}:1`);
    expect(keys[3]).toBe(`${keys[0]}:2`);
    expect(getSuggestionKeys([{ ...a }])).toEqual([keys[0]]);
  });
});

describe('[nxaSuggestionTitle] and [nxaSuggestionDescription]', () => {
  it('follow a live suggestion runtime', async () => {
    const state = signal({ title: 'One', label: 'first', prompt: 'p' });
    const listeners = new Set<() => void>();
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaSuggestionTitle, NxaSuggestionDescription],
      providers: [
        provideSuggestionScope(() => ({
          getState: () => state(),
          subscribe: (callback) => {
            listeners.add(callback);
            return () => listeners.delete(callback);
          },
        })),
      ],
      template: `<span nxaSuggestionTitle class="title"></span
        ><span nxaSuggestionDescription class="label"></span>`,
    })
    class Live {}
    const fixture = await mount([], Live);
    expect(texts(fixture, '.title')).toEqual(['One']);

    state.set({ title: 'Two', label: 'second', prompt: 'p' });
    listeners.forEach((listener) => listener());
    await until(fixture, () => {
      expect(texts(fixture, '.title')).toEqual(['Two']);
      expect(texts(fixture, '.label')).toEqual(['second']);
    });
    fixture.destroy();
    expect(listeners.size).toBe(0);
  });
});

describe('suggestionSendMode', () => {
  const state = (fields: Partial<ThreadState>, queue = false) =>
    ({
      isSendDisabled: false,
      isRunning: false,
      voice: undefined,
      capabilities: { queue },
      ...fields,
    }) as unknown as ThreadState;

  it('tells now, queued and blocked apart', () => {
    expect(suggestionSendMode(state({}))).toBe('now');
    expect(suggestionSendMode(state({ isRunning: true }))).toBe('blocked');
    expect(suggestionSendMode(state({ isRunning: true }, true))).toBe('queued');
    expect(suggestionSendMode(state({ isSendDisabled: true }))).toBe('blocked');
    const voice = (canSendText: boolean) => ({ canSendText }) as unknown as ThreadState['voice'];
    expect(suggestionSendMode(state({ isRunning: true, voice: voice(true) }))).toBe('now');
    expect(suggestionSendMode(state({ voice: voice(false) }))).toBe('blocked');
  });
});

/**
 * A fake thread and composer, so a test can set any combination of run, send and voice state.
 * Mirrors the state the trigger reads; everything else is left out.
 */
function fakeThread() {
  const thread = signal({
    isDisabled: false,
    isSendDisabled: false,
    isRunning: false,
    capabilities: { queue: false },
    voice: undefined as { canSendText: boolean } | undefined,
  });
  const composer = signal({ text: '', runConfig: { custom: { model: 'test-model' } } });
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const subscribe = (callback: () => void) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  };
  const append = vi.fn();
  const setText = vi.fn();
  const providers: Provider[] = [
    {
      provide: NXA_THREAD,
      useValue: { getState: () => thread(), subscribe, append } as unknown as ThreadRuntime,
    },
    {
      provide: NXA_COMPOSER,
      useValue: { getState: () => composer(), subscribe, setText } as unknown as ComposerRuntime,
    },
  ];
  return {
    providers,
    append,
    setText,
    setThread: (patch: Partial<ReturnType<typeof thread>>) => {
      thread.update((state) => ({ ...state, ...patch }));
      notify();
    },
    setDraft: (text: string) => {
      composer.update((state) => ({ ...state, text }));
      notify();
    },
  };
}

const PROMPT = new InjectionToken<string>('PROMPT');

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaSuggestionTrigger],
  providers: [
    provideSuggestionScope(() => {
      const state = { title: 'Hello', label: '', prompt: inject(PROMPT) };
      return { getState: () => state, subscribe: () => () => undefined };
    }),
  ],
  template: `<button
    nxaSuggestionTrigger
    [send]="send()"
    [clearComposer]="clearComposer()"
    [disabled]="disabled()"
  >
    Use
  </button>`,
})
class Trigger {
  readonly send = signal(false);
  readonly clearComposer = signal(true);
  readonly disabled = signal(false);
}

async function mountTrigger(
  options: { send?: boolean; clearComposer?: boolean; prompt?: string } = {},
  configure?: (fake: ReturnType<typeof fakeThread>) => void,
) {
  const fake = fakeThread();
  configure?.(fake);
  const fixture = await mount(
    [...fake.providers, { provide: PROMPT, useValue: options.prompt ?? 'Hello' }],
    Trigger,
  );
  fixture.componentInstance.send.set(options.send ?? false);
  fixture.componentInstance.clearComposer.set(options.clearComposer ?? true);
  fixture.detectChanges();
  const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;
  return { fixture, fake, button };
}

describe('button[nxaSuggestionTrigger]', () => {
  const sent = (text: string) => ({
    content: [{ type: 'text', text }],
    runConfig: { custom: { model: 'test-model' } },
  });

  it('appends the prompt and clears the composer when sending while idle', async () => {
    const { fake, button } = await mountTrigger({ send: true });
    expect(button.disabled).toBe(false);
    click(button);
    expect(fake.append).toHaveBeenCalledWith(sent('Hello'));
    expect(fake.setText).toHaveBeenCalledWith('');
  });

  it('keeps the composer when sending with clearComposer off', async () => {
    const { fake, button } = await mountTrigger({ send: true, clearComposer: false });
    click(button);
    expect(fake.append).toHaveBeenCalledWith(sent('Hello'));
    expect(fake.setText).not.toHaveBeenCalled();
  });

  it('is disabled and does nothing when sending while running without queue support', async () => {
    const { fake, button } = await mountTrigger({ send: true }, (f) => {
      f.setThread({ isRunning: true });
      f.setDraft('my draft');
    });
    expect(button.disabled).toBe(true);
    click(button);
    expect(fake.append).not.toHaveBeenCalled();
    expect(fake.setText).not.toHaveBeenCalled();
  });

  it('queues without touching the composer while running when the thread queues', async () => {
    const { fake, button } = await mountTrigger({ send: true }, (f) => {
      f.setThread({ isRunning: true, capabilities: { queue: true } });
      f.setDraft('my draft');
    });
    expect(button.disabled).toBe(false);
    click(button);
    expect(fake.append).toHaveBeenCalledWith(sent('Hello'));
    expect(fake.setText).not.toHaveBeenCalled();
  });

  it('checks the send policy again on click', async () => {
    const { fixture, fake, button } = await mountTrigger({ send: true });
    fake.setThread({ isSendDisabled: true });
    // Before change detection disables the button.
    click(button);
    expect(fake.append).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
  });

  it('sends into a voice session that takes typed text during a spoken reply', async () => {
    const { fake, button } = await mountTrigger({ send: true }, (f) => {
      f.setThread({ isRunning: true, voice: { canSendText: true } });
      f.setDraft('my draft');
    });
    expect(button.disabled).toBe(false);
    click(button);
    expect(fake.append).toHaveBeenCalledWith(sent('Hello'));
    expect(fake.setText).toHaveBeenCalledWith('');
  });

  it('is disabled while a voice session does not take typed text', async () => {
    const { fake, button } = await mountTrigger({ send: true }, (f) =>
      f.setThread({ voice: { canSendText: false } }),
    );
    expect(button.disabled).toBe(true);
    click(button);
    expect(fake.append).not.toHaveBeenCalled();
  });

  it('replaces the composer text without send, even while running', async () => {
    const { fake, button } = await mountTrigger({}, (f) => {
      f.setThread({ isRunning: true, isSendDisabled: true });
      f.setDraft('my draft');
    });
    expect(button.disabled).toBe(false);
    click(button);
    expect(fake.append).not.toHaveBeenCalled();
    expect(fake.setText).toHaveBeenCalledWith('Hello');
  });

  it('adds to the composer text with clearComposer off', async () => {
    const { fake, button } = await mountTrigger({ clearComposer: false }, (f) =>
      f.setDraft('my draft'),
    );
    click(button);
    expect(fake.setText).toHaveBeenCalledWith('my draft Hello');
  });

  it('adds no separator for an empty prompt', async () => {
    const { fake, button } = await mountTrigger({ clearComposer: false, prompt: '' }, (f) =>
      f.setDraft('my draft'),
    );
    click(button);
    expect(fake.setText).toHaveBeenCalledWith('my draft');
  });

  it('inserts the prompt alone into an empty composer with clearComposer off', async () => {
    const { fake, button } = await mountTrigger({ clearComposer: false });
    click(button);
    expect(fake.setText).toHaveBeenCalledWith('Hello');
  });

  it('is disabled while the thread is disabled, or by its input', async () => {
    const { fixture, fake, button } = await mountTrigger({}, (f) =>
      f.setThread({ isDisabled: true }),
    );
    expect(button.disabled).toBe(true);

    fake.setThread({ isDisabled: false });
    fixture.detectChanges();
    expect(button.disabled).toBe(false);

    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
    click(button);
    expect(fake.setText).not.toHaveBeenCalled();
  });

  it('lets a capture-phase listener veto it', async () => {
    const { fixture, fake, button } = await mountTrigger();
    fixture.nativeElement.addEventListener('click', (event: Event) => event.preventDefault(), {
      capture: true,
    });
    click(button);
    expect(fake.setText).not.toHaveBeenCalled();
  });
});

describe('suggestions with a real runtime', () => {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NxaSuggestions, NxaSuggestionTrigger, NxaSuggestionTitle],
    template: `
      <button *nxaSuggestions nxaSuggestionTrigger [send]="send">
        <span nxaSuggestionTitle></span>
      </button>
    `,
  })
  class Chat {
    send = true;
    readonly thread = injectThread();
    readonly composer = injectComposer();
  }

  it('sends a suggestion as a user message with the run config, and clears the draft', async () => {
    const store = createStore([{ title: 'Joke', prompt: 'Tell me a joke' }]);
    const fixture = await mount([store.provider], Chat);
    const { composer } = fixture.componentInstance;
    composer.setText('draft');
    composer.setRunConfig({ custom: { tone: 'dry' } });

    click((fixture.nativeElement as HTMLElement).querySelector('button')!);
    await until(fixture, () => expect(store.onNew).toHaveBeenCalledOnce());
    expect(store.onNew.mock.calls[0]![0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Tell me a joke' }],
      runConfig: { custom: { tone: 'dry' } },
    });
    expect(composer.getState().text).toBe('');
  });

  it('puts the prompt in the thread composer without send', async () => {
    const store = createStore([{ prompt: 'Summarize' }]);
    TestBed.configureTestingModule({ providers: [store.provider] });
    const fixture = TestBed.createComponent(Chat);
    fixture.componentInstance.send = false;
    fixture.detectChanges();
    await fixture.whenStable();

    click((fixture.nativeElement as HTMLElement).querySelector('button')!);
    expect(fixture.componentInstance.composer.getState().text).toBe('Summarize');
    expect(store.onNew).not.toHaveBeenCalled();
    expect(TestBed.inject(NXA_ASSISTANT)!.thread.getState().suggestions).toHaveLength(1);
  });
});
