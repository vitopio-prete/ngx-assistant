import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ExternalStoreAdapter, ThreadMessageLike } from '@ngx-assistant/engine';
import { provideExternalStoreRuntime } from '../external-store-runtime';
import { NxaMessageParts } from '../messages/message-parts';
import { NxaMessageRoot } from '../messages/message-root';
import { NxaMessages } from '../messages/messages';
import { NxaMessagePartByIndex } from './message-part-by-index';
import { NxaMessagePartInProgress } from './message-part-in-progress';
import { NxaMessagePartText } from './message-part-text';
import { NxaReasoningGroup } from './reasoning-group';
import type { NxaSmooth } from './smooth-text';

type Content = Exclude<ThreadMessageLike['content'], string>;
const reasoning = (text: string) => ({ type: 'reasoning' as const, text });
const textPart = (text: string) => ({ type: 'text' as const, text });

const reply = (content: Content, running: boolean): ThreadMessageLike => ({
  id: 'a1',
  role: 'assistant',
  content,
  status: running ? { type: 'running' } : { type: 'complete', reason: 'stop' },
});

/** An external store with one assistant reply whose content and run state the test sets. */
function createStore(content: Content, running = false) {
  const messages = signal<readonly ThreadMessageLike[]>([reply(content, running)]);
  const isRunning = signal(running);
  const provider = provideExternalStoreRuntime<ThreadMessageLike>(() =>
    computed((): ExternalStoreAdapter<ThreadMessageLike> => ({
      messages: messages(),
      isRunning: isRunning(),
      convertMessage: (message) => message,
      onNew: async () => undefined,
    })),
  );
  return {
    provider,
    set(next: Content, nextRunning: boolean) {
      messages.set([reply(next, nextRunning)]);
      isRunning.set(nextRunning);
    },
  };
}

type Store = ReturnType<typeof createStore>;

function host(store: Store) {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
      NxaMessages,
      NxaMessageRoot,
      NxaMessageParts,
      NxaMessagePartText,
      NxaMessagePartInProgress,
      NxaMessagePartByIndex,
      NxaReasoningGroup,
    ],
    providers: [store.provider],
    template: `
      <div class="scroller" style="overflow-y: auto">
        <article *nxaMessages="let message" nxaMessageRoot>
          <ng-container *nxaMessageParts="let part">
            @if (part().type === 'text') {
              <p class="text" nxaMessagePartText [smooth]="smooth()">ignored</p>
              <span *nxaMessagePartInProgress class="dot">●</span>
            } @else if (part().type === 'reasoning') {
              <section
                *nxaReasoningGroup="let group; lockMs: 60"
                class="group"
                [attr.data-range]="group.startIndex() + '-' + group.endIndex()"
                [attr.data-open]="group.open()"
                [attr.data-streaming]="group.streaming()"
              >
                <button class="toggle" (click)="group.toggle()">Reasoning</button>
                @for (index of group.indices(); track index) {
                  <span
                    *nxaMessagePartByIndex="index"
                    class="step"
                    nxaMessagePartText
                    smooth="false"
                    >x</span
                  >
                }
              </section>
            }
          </ng-container>
        </article>
      </div>
    `,
  })
  class Host {
    readonly smooth = signal<NxaSmooth>(false);
  }
  return Host;
}

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await fixture.whenStable();
}

async function mount(store: Store) {
  const fixture = TestBed.createComponent(host(store));
  fixture.detectChanges();
  await settle(fixture);
  return fixture;
}

const all = (fixture: ComponentFixture<unknown>, selector: string) =>
  Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(selector));
const one = (fixture: ComponentFixture<unknown>, selector: string) => all(fixture, selector)[0]!;

const groups = (fixture: ComponentFixture<unknown>) =>
  all(fixture, '.group').map((group) => ({
    range: group.dataset['range'],
    steps: Array.from(group.querySelectorAll('.step')).map((step) => step.textContent),
  }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('nxaMessagePartText', () => {
  it('writes the text of the part in its element with its status', async () => {
    const store = createStore([textPart('Hello')]);
    const fixture = await mount(store);
    const text = one(fixture, '.text');
    expect(text.textContent).toBe('Hello');
    expect(text.dataset['nxaStatus']).toBe('complete');

    store.set([textPart('Hello again')], true);
    await settle(fixture);
    expect(text.textContent).toBe('Hello again');
    expect(text.dataset['nxaStatus']).toBe('running');
  });

  it('reveals a streaming text frame by frame', async () => {
    let now = 0;
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const frame = async (fixture: ComponentFixture<unknown>) => {
      now += 16;
      frames.splice(0).forEach((callback) => callback(now));
      await settle(fixture);
    };

    const store = createStore([textPart('')], true);
    const fixture = await mount(store);
    fixture.componentInstance.smooth.set({ maxCharsPerFrame: 2 });
    await settle(fixture);
    store.set([textPart('Hello')], true);
    await settle(fixture);
    const text = one(fixture, '.text');
    expect(text.textContent).toBe('');

    await frame(fixture);
    expect(text.textContent).toBe('He');
    expect(text.dataset['nxaStatus']).toBe('running');

    // The run ends: what is left goes on revealing, and the status waits for it.
    store.set([textPart('Hello')], false);
    await settle(fixture);
    expect(text.dataset['nxaStatus']).toBe('running');
    await frame(fixture);
    await frame(fixture);
    expect(text.textContent).toBe('Hello');
    expect(text.dataset['nxaStatus']).toBe('complete');
  });

  it('takes smooth as a plain attribute', async () => {
    const store = createStore([reasoning('step')], true);
    const fixture = await mount(store);
    // `smooth="false"` on the steps: the running text shows at once.
    expect(one(fixture, '.step').textContent).toBe('step');
  });
});

describe('nxaMessagePartInProgress', () => {
  it('renders while the part runs', async () => {
    const store = createStore([textPart('Hel')], true);
    const fixture = await mount(store);
    expect(all(fixture, '.dot')).toHaveLength(1);

    store.set([textPart('Hello')], false);
    await settle(fixture);
    expect(all(fixture, '.dot')).toHaveLength(0);
  });
});

describe('nxaReasoningGroup', () => {
  it('renders one group per run of consecutive reasoning parts', async () => {
    const store = createStore([reasoning('a'), reasoning('b'), textPart('answer'), reasoning('c')]);
    const fixture = await mount(store);
    expect(groups(fixture)).toEqual([
      { range: '0-1', steps: ['a', 'b'] },
      { range: '3-3', steps: ['c'] },
    ]);
  });

  it('follows the parts as they arrive and change type', async () => {
    const store = createStore([reasoning('a')], true);
    const fixture = await mount(store);
    expect(groups(fixture)).toEqual([{ range: '0-0', steps: ['a'] }]);

    store.set([reasoning('a'), reasoning('b')], true);
    await settle(fixture);
    expect(groups(fixture)).toEqual([{ range: '0-1', steps: ['a', 'b'] }]);

    store.set([reasoning('a'), reasoning('b'), textPart('answer')], true);
    await settle(fixture);
    expect(groups(fixture)).toEqual([{ range: '0-1', steps: ['a', 'b'] }]);

    // The first part turns into text: the run now starts at the second.
    store.set([textPart('lead'), reasoning('b'), textPart('answer')], false);
    await settle(fixture);
    expect(groups(fixture)).toEqual([{ range: '1-1', steps: ['b'] }]);

    // Two runs join into one.
    store.set([reasoning('a'), reasoning('b'), reasoning('c')], false);
    await settle(fixture);
    expect(groups(fixture)).toEqual([{ range: '0-2', steps: ['a', 'b', 'c'] }]);
  });

  it('is open while the model reasons and closes after, until the user chooses', async () => {
    const store = createStore([reasoning('a')], true);
    const fixture = await mount(store);
    const group = () => one(fixture, '.group');
    expect(group().dataset['streaming']).toBe('true');
    expect(group().dataset['open']).toBe('true');

    // The answer starts: the reasoning is done.
    store.set([reasoning('a'), textPart('answer')], true);
    await settle(fixture);
    expect(group().dataset['streaming']).toBe('false');
    expect(group().dataset['open']).toBe('false');

    one(fixture, '.toggle').click();
    await settle(fixture);
    expect(group().dataset['open']).toBe('true');

    // A new run of reasoning does not override the choice.
    store.set([reasoning('a'), textPart('answer'), reasoning('b')], true);
    await settle(fixture);
    expect(group().dataset['open']).toBe('true');
    one(fixture, '.toggle').click();
    await settle(fixture);
    expect(group().dataset['open']).toBe('false');
  });

  it('locks the scroll when it opens or closes', async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const store = createStore([reasoning('a')], true);
    const fixture = await mount(store);
    const scroller = one(fixture, '.scroller');
    expect(scroller.style.scrollbarWidth).toBe('');

    // Closing by itself at the end of the stream.
    store.set([reasoning('a'), textPart('answer')], true);
    await settle(fixture);
    expect(scroller.style.scrollbarWidth).toBe('none');
    await wait(80);
    expect(scroller.style.scrollbarWidth).toBe('');

    // Opened by the user, for `lockMs`.
    one(fixture, '.toggle').click();
    expect(scroller.style.scrollbarWidth).toBe('none');
    await wait(80);
    expect(scroller.style.scrollbarWidth).toBe('');

    // Destroying the group ends the lock in progress.
    one(fixture, '.toggle').click();
    expect(scroller.style.scrollbarWidth).toBe('none');
    store.set([textPart('answer')], false);
    await settle(fixture);
    expect(all(fixture, '.group')).toHaveLength(0);
    expect(scroller.style.scrollbarWidth).toBe('');
  });

  it('locks the scroll once for a run of several parts, and restores it', async () => {
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const store = createStore([reasoning('a'), reasoning('b')], true);
    const fixture = await mount(store);
    const scroller = one(fixture, '.scroller');
    scroller.style.paddingRight = '4px';
    Object.defineProperty(scroller, 'offsetWidth', { configurable: true, value: 306 });
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: 300 });

    store.set([reasoning('a'), reasoning('b'), textPart('answer')], true);
    await settle(fixture);
    expect(scroller.style.scrollbarWidth).toBe('none');
    expect(scroller.style.paddingRight).toBe('10px');
    await wait(80);
    expect(scroller.style.scrollbarWidth).toBe('');
    expect(scroller.style.paddingRight).toBe('4px');
  });
});

describe('nxaMessagePartByIndex', () => {
  function byIndexHost(store: Store) {
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaMessages, NxaMessagePartByIndex, NxaMessagePartText],
      providers: [store.provider],
      template: `
        <article *nxaMessages="let message">
          <span
            *nxaMessagePartByIndex="index()"
            class="part"
            nxaMessagePartText
            smooth="false"
          ></span>
        </article>
      `,
    })
    class Host {
      readonly index = signal(0);
    }
    return Host;
  }

  it('follows its index, and renders nothing where there is no part', async () => {
    const store = createStore([textPart('zero'), textPart('one')]);
    const fixture = TestBed.createComponent(byIndexHost(store));
    fixture.detectChanges();
    await settle(fixture);
    const parts = () => all(fixture, '.part').map((part) => part.textContent);
    expect(parts()).toEqual(['zero']);

    fixture.componentInstance.index.set(1);
    await settle(fixture);
    expect(parts()).toEqual(['one']);

    fixture.componentInstance.index.set(2);
    await settle(fixture);
    expect(parts()).toEqual([]);

    // The part arrives.
    store.set([textPart('zero'), textPart('one'), textPart('two')], false);
    await settle(fixture);
    expect(parts()).toEqual(['two']);

    fixture.componentInstance.index.set(Number.NaN);
    await settle(fixture);
    expect(parts()).toEqual([]);
  });
});

describe('nxaMessagePartText smooth input', () => {
  it.each([
    { smooth: undefined, revealed: false },
    { smooth: null, revealed: true },
    { smooth: false, revealed: true },
  ])('smooth $smooth', async ({ smooth, revealed }) => {
    vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const store = createStore([textPart('Hello')], true);
    const fixture = TestBed.createComponent(host(store));
    fixture.componentInstance.smooth.set(smooth);
    fixture.detectChanges();
    await settle(fixture);
    // A smooth text starts empty while it runs; an off one shows at once.
    expect(one(fixture, '.text').textContent).toBe(revealed ? 'Hello' : '');
  });
});
