import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ThreadMessageLike } from '@ngx-assistant/engine';
import { NxaComposerInput } from '../composer/composer-input';
import { provideExternalStoreRuntime } from '../external-store-runtime';
import { injectThread, provideMessageScope } from '../scopes';
import { NxaScrollToBottom } from './scroll-to-bottom';
import { NxaThreadViewport } from './thread-viewport';
import { NxaThreadViewportFooter } from './thread-viewport-footer';

// Geometry: the viewport is 100px tall and each row is 80px, unless a test sets a row height or
// the content height. Every row sits in the viewport's content, one after another.
const CLIENT_HEIGHT = 100;
const ROW_HEIGHT = 80;
const rowHeights = new Map<string, number>();
let contentHeight: number | null = null;
let contentOffset = 0;
const scrollTops = new WeakMap<Element, number>();
const scrollTo = vi.fn();

const isViewport = (element: Element) => element.getAttribute('data-testid') === 'viewport';
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-nxa-message-id]')];
const rowHeight = (row: Element) =>
  rowHeights.get(row.getAttribute('data-nxa-message-id') ?? '') ?? ROW_HEIGHT;
const rowsHeight = (list: readonly Element[]) =>
  list.reduce((height, row) => height + rowHeight(row), 0);
const maxScrollTop = (element: HTMLElement) =>
  Math.max(0, element.scrollHeight - element.clientHeight);

class TestResizeObserver {
  static readonly all = new Set<TestResizeObserver>();
  readonly targets = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.all.add(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    TestResizeObserver.all.delete(this);
  }
  notify() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

/** Notifies the observers watching `target`, or every observer. */
const resize = (target?: Element) => {
  for (const observer of [...TestResizeObserver.all]) {
    if (!target || observer.targets.has(target)) observer.notify();
  }
};

const descriptors = Object.fromEntries(
  ['scrollTop', 'scrollHeight', 'clientHeight', 'scrollTo', 'getBoundingClientRect'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, key) ??
      Object.getOwnPropertyDescriptor(Element.prototype, key),
  ]),
);

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    scrollTop: {
      configurable: true,
      get(this: HTMLElement) {
        return scrollTops.get(this) ?? 0;
      },
      set(this: HTMLElement, value: number) {
        scrollTops.set(this, value);
      },
    },
    clientHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return isViewport(this) ? CLIENT_HEIGHT : 0;
      },
    },
    scrollHeight: {
      configurable: true,
      get(this: HTMLElement) {
        if (!isViewport(this)) return 0;
        return (contentHeight ?? rowsHeight(rows())) + contentOffset;
      },
    },
    scrollTo: {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        scrollTo(options);
        this.scrollTop = Math.max(0, Math.min(Number(options.top ?? 0), maxScrollTop(this)));
        this.dispatchEvent(new Event('scroll'));
      },
    },
    getBoundingClientRect: {
      configurable: true,
      value(this: HTMLElement) {
        const list = rows();
        const index = list.indexOf(this);
        const viewport = this.closest<HTMLElement>('[data-testid="viewport"]');
        const top =
          index === -1 ? 0 : rowsHeight(list.slice(0, index)) - (viewport?.scrollTop ?? 0);
        const height = index === -1 ? 0 : rowHeight(this);
        return { x: 0, y: top, top, bottom: top + height, left: 0, right: 0, width: 0, height };
      },
    },
  });
});

afterAll(() => {
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, key);
  }
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  scrollTo.mockReset();
  rowHeights.clear();
  contentHeight = null;
  contentOffset = 0;
  TestResizeObserver.all.clear();
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

const message = (index: number): ThreadMessageLike => ({
  id: `m${index}`,
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: [{ type: 'text', text: `Message ${index}` }],
});
const range = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, index) => message(from + index));

/** The store behind the runtime: the host renders its messages as rows. */
const store = {
  messages: signal<readonly ThreadMessageLike[]>([]),
  isRunning: signal(false),
  threadId: signal('a'),
};

const options = {
  autoScroll: signal(true),
  scrollToBottomOnInitialize: signal(true),
  scrollToBottomOnRunStart: signal(true),
  scrollToBottomOnThreadSwitch: signal(true),
  footers: signal<readonly { height: number; marginTop?: number }[]>([]),
  composer: signal(false),
  editComposer: signal(false),
  focusOnScrollToBottom: signal(true),
  viewport: signal(true),
};

/** The edit composer of the first message. */
@Component({
  selector: 'nxa-test-edit-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaComposerInput],
  providers: [provideMessageScope(() => injectThread().getMessageByIndex(0))],
  template: `<textarea nxaComposerInput autoFocus data-testid="edit-composer"></textarea>`,
})
class EditComposer {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaThreadViewport,
    NxaThreadViewportFooter,
    NxaScrollToBottom,
    NxaComposerInput,
    EditComposer,
  ],
  providers: [
    provideExternalStoreRuntime(
      computed(() => ({
        messages: store.messages(),
        isRunning: store.isRunning(),
        convertMessage: (m: ThreadMessageLike) => m,
        onNew: async () => undefined,
        adapters: { threadList: { threadId: store.threadId() } },
      })),
    ),
  ],
  template: `
    @if (options.viewport()) {
      <div
        nxaThreadViewport
        #viewport="nxaThreadViewport"
        data-testid="viewport"
        [autoScroll]="options.autoScroll()"
        [scrollToBottomOnInitialize]="options.scrollToBottomOnInitialize()"
        [scrollToBottomOnRunStart]="options.scrollToBottomOnRunStart()"
        [scrollToBottomOnThreadSwitch]="options.scrollToBottomOnThreadSwitch()"
      >
        @for (m of store.messages(); track m.id) {
          <div [attr.data-nxa-message-id]="m.id">
            {{ m.id
            }}<button aria-expanded="false" [attr.data-testid]="'expand-' + m.id">More</button>
          </div>
        }
        @for (footer of options.footers(); track $index) {
          <div
            nxaThreadViewportFooter
            data-testid="footer"
            [style.margin-top.px]="footer.marginTop ?? 0"
            [attr.data-height]="footer.height"
          ></div>
        }
        <button nxaScrollToBottom data-testid="scroll-to-bottom">Scroll to bottom</button>
        @if (options.composer()) {
          <textarea
            nxaComposerInput
            autoFocus
            [focusOnScrollToBottom]="options.focusOnScrollToBottom()"
          ></textarea>
        }
        @if (options.editComposer()) {
          <nxa-test-edit-composer />
        }
      </div>
    }
    <button data-testid="outside">Outside</button>
  `,
})
class Host {
  readonly store = store;
  readonly options = options;
}

interface Mounted {
  fixture: ComponentFixture<Host>;
  viewport: HTMLElement;
  button: HTMLButtonElement;
}

const render = async (messages: readonly ThreadMessageLike[] = []): Promise<Mounted> => {
  store.messages.set(messages);
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  return {
    fixture,
    viewport: root.querySelector<HTMLElement>('[data-testid="viewport"]')!,
    button: root.querySelector<HTMLButtonElement>('[data-testid="scroll-to-bottom"]')!,
  };
};

/** Lets the runtime, change detection and the observers settle, then runs the next frame. */
const settle = async (fixture: ComponentFixture<Host>) => {
  await fixture.whenStable();
  await flush();
  vi.advanceTimersToNextFrame();
  await fixture.whenStable();
};

const scrollBy = (viewport: HTMLElement, top: number) => {
  viewport.scrollTop = top;
  viewport.dispatchEvent(new Event('scroll'));
};

const atBottom = (viewport: HTMLElement) => viewport.hasAttribute('data-nxa-at-bottom');

/** Renders a thread that overflows the viewport, pinned to its bottom. */
const renderOverflowing = async () => {
  const mounted = await render(range(0, 4));
  await settle(mounted.fixture);
  expect(mounted.viewport.scrollTop).toBe(4 * ROW_HEIGHT - CLIENT_HEIGHT);
  return mounted;
};

describe('nxaThreadViewport', () => {
  beforeEach(() => {
    store.messages.set([]);
    store.isRunning.set(false);
    store.threadId.set('a');
    options.autoScroll.set(true);
    options.scrollToBottomOnInitialize.set(true);
    options.scrollToBottomOnRunStart.set(true);
    options.scrollToBottomOnThreadSwitch.set(true);
    options.footers.set([]);
    options.composer.set(false);
    options.editComposer.set(false);
    options.focusOnScrollToBottom.set(true);
    options.viewport.set(true);
  });

  it('seeds an initial scroll once messages exist', async () => {
    const { fixture, viewport } = await render(range(0, 4));
    await settle(fixture);

    expect(scrollTo).toHaveBeenCalledWith({ top: 320, behavior: 'instant' });
    expect(viewport.scrollTop).toBe(220);
    expect(atBottom(viewport)).toBe(true);
  });

  it('seeds the initial scroll when the first messages arrive later', async () => {
    const { fixture, viewport } = await render();
    await settle(fixture);
    expect(scrollTo).not.toHaveBeenCalled();

    store.messages.set(range(0, 4));
    await settle(fixture);
    expect(viewport.scrollTop).toBe(220);
  });

  it('scrolls existing messages to the bottom when the viewport mounts later', async () => {
    options.viewport.set(false);
    const { fixture } = await render(range(0, 4));
    await settle(fixture);

    options.viewport.set(true);
    await settle(fixture);
    const viewport = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="viewport"]',
    )!;
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 320, behavior: 'instant' });
    expect(viewport.scrollTop).toBe(220);
  });

  it("keeps run start's auto behavior on the first message of an empty thread", async () => {
    const { fixture, viewport } = await render();
    await settle(fixture);

    store.messages.set(range(0, 4));
    store.isRunning.set(true);
    await settle(fixture);

    expect(scrollTo).toHaveBeenCalledWith({ top: 320, behavior: 'auto' });
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 320, behavior: 'instant' });
    expect(viewport.scrollTop).toBe(220);
  });

  it('keeps its listeners and observers when its inputs change', async () => {
    const { fixture } = await renderOverflowing();
    const observers = [...TestResizeObserver.all];
    const add = vi.spyOn(HTMLElement.prototype, 'addEventListener');

    options.autoScroll.set(false);
    options.scrollToBottomOnRunStart.set(false);
    await settle(fixture);

    expect([...TestResizeObserver.all]).toEqual(observers);
    expect(add).not.toHaveBeenCalled();
  });

  it('pauses the follow when a collapsed disclosure in a message opens', async () => {
    const { fixture, viewport } = await renderOverflowing();

    viewport.querySelector<HTMLElement>('[data-testid="expand-m3"]')!.click();
    store.messages.set(range(0, 6));
    await settle(fixture);

    expect(viewport.scrollTop).toBe(220);
  });

  it('does not scroll initial messages when initialize scrolling is disabled', async () => {
    options.scrollToBottomOnInitialize.set(false);
    options.autoScroll.set(false);
    const { fixture, viewport } = await render(range(0, 4));
    await settle(fixture);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(0);
  });

  it('follows content growth while pinned to the bottom', async () => {
    const { fixture, viewport } = await renderOverflowing();

    store.messages.set(range(0, 6));
    await settle(fixture);

    expect(scrollTo).toHaveBeenLastCalledWith({ top: 480, behavior: 'instant' });
    expect(viewport.scrollTop).toBe(380);
  });

  it('follows a message that grows without a DOM mutation', async () => {
    const { fixture, viewport } = await renderOverflowing();

    rowHeights.set('m3', 200);
    resize(viewport.querySelector('[data-nxa-message-id="m3"]')!);
    await settle(fixture);

    expect(viewport.scrollTop).toBe(340);
  });

  it('a user scroll up unpins and growth stops following', async () => {
    const { fixture, viewport } = await renderOverflowing();

    scrollBy(viewport, 100);
    await fixture.whenStable();
    expect(atBottom(viewport)).toBe(false);

    scrollTo.mockClear();
    store.messages.set(range(0, 6));
    await settle(fixture);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(100);
  });

  it('returning to the bottom repins', async () => {
    const { fixture, viewport } = await renderOverflowing();
    scrollBy(viewport, 100);
    scrollBy(viewport, 220);
    await fixture.whenStable();
    expect(atBottom(viewport)).toBe(true);

    store.messages.set(range(0, 6));
    await settle(fixture);
    expect(viewport.scrollTop).toBe(380);
  });

  it('scrolls on run start and honors the option gate', async () => {
    const { fixture, viewport } = await renderOverflowing();
    scrollBy(viewport, 0);

    store.isRunning.set(true);
    await settle(fixture);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 320, behavior: 'auto' });
    expect(viewport.scrollTop).toBe(220);

    store.isRunning.set(false);
    options.scrollToBottomOnRunStart.set(false);
    await settle(fixture);
    scrollBy(viewport, 0);
    scrollTo.mockClear();
    store.isRunning.set(true);
    await settle(fixture);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(0);
  });

  it('scrolls instantly on a thread switch and honors the option gate', async () => {
    const { fixture, viewport } = await renderOverflowing();
    scrollBy(viewport, 0);

    store.threadId.set('b');
    await settle(fixture);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 320, behavior: 'instant' });
    expect(viewport.scrollTop).toBe(220);

    options.scrollToBottomOnThreadSwitch.set(false);
    scrollBy(viewport, 0);
    scrollTo.mockClear();
    store.threadId.set('c');
    await settle(fixture);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('a pointer gesture cancels a scheduled scroll', async () => {
    const { fixture, viewport } = await renderOverflowing();
    scrollBy(viewport, 0);
    scrollTo.mockClear();

    store.isRunning.set(true);
    await fixture.whenStable();
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    viewport.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersToNextFrame();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(viewport.scrollTop).toBe(0);
  });

  it('stops observing and cancels a scheduled scroll when destroyed', async () => {
    const { fixture, viewport } = await renderOverflowing();
    scrollBy(viewport, 0);
    store.isRunning.set(true);
    await fixture.whenStable();
    await flush();
    expect(vi.getTimerCount()).toBe(1);

    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
    expect(TestResizeObserver.all.size).toBe(0);
    scrollTo.mockClear();
    viewport.dispatchEvent(new Event('scroll'));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('marks the at-bottom state with data-nxa-at-bottom', async () => {
    const { fixture, viewport } = await renderOverflowing();
    expect(viewport.getAttribute('data-nxa-at-bottom')).toBe('');

    scrollBy(viewport, 100);
    await fixture.whenStable();
    expect(viewport.hasAttribute('data-nxa-at-bottom')).toBe(false);
  });

  describe('earlier messages', () => {
    const renderAt = async (scrollTop: number) => {
      const mounted = await render(range(4, 8));
      await settle(mounted.fixture);
      scrollBy(mounted.viewport, scrollTop);
      await mounted.fixture.whenStable();
      return mounted;
    };

    const prepend = async (fixture: ComponentFixture<Host>) => {
      store.messages.set(range(0, 8));
      await settle(fixture);
      resize();
    };

    it('keeps the rows a reader scrolled to in place when an earlier page is prepended', async () => {
      const { fixture, viewport } = await renderAt(0);

      await prepend(fixture);

      expect(viewport.scrollTop).toBe(4 * ROW_HEIGHT);
    });

    it.each([true, false])(
      'keeps a reader at the bottom at the bottom (autoScroll %s)',
      async (autoScroll) => {
        options.autoScroll.set(autoScroll);
        const { fixture, viewport } = await renderAt(4 * ROW_HEIGHT - CLIENT_HEIGHT);

        await prepend(fixture);

        expect(viewport.scrollTop).toBe(8 * ROW_HEIGHT - CLIENT_HEIGHT);
      },
    );

    it('does not count growth below the reader in the same update as part of the page', async () => {
      const { fixture, viewport } = await renderAt(100);
      contentOffset = 40;

      await prepend(fixture);

      expect(viewport.scrollTop).toBe(4 * ROW_HEIGHT + 100);
    });

    it("holds the rows in place while the page above settles, until the reader's next gesture", async () => {
      const { fixture, viewport } = await renderAt(0);
      await prepend(fixture);
      expect(viewport.scrollTop).toBe(320);

      rowHeights.set('m3', 120);
      resize();
      expect(viewport.scrollTop).toBe(360);

      viewport.dispatchEvent(new Event('wheel'));
      rowHeights.set('m2', 120);
      resize();
      expect(viewport.scrollTop).toBe(360);
    });

    it('lets go of the held rows when a run starts', async () => {
      options.scrollToBottomOnRunStart.set(false);
      options.autoScroll.set(false);
      const { fixture, viewport } = await renderAt(0);
      await prepend(fixture);

      store.isRunning.set(true);
      await settle(fixture);
      rowHeights.set('m3', 120);
      resize();

      expect(viewport.scrollTop).toBe(320);
    });

    it('holds the row the reader sees, not the old first message, while content between them settles', async () => {
      const { fixture, viewport } = await renderAt(100);
      await prepend(fixture);
      expect(viewport.scrollTop).toBe(420);

      rowHeights.set('m4', 120);
      resize();
      expect(viewport.scrollTop).toBe(460);
    });

    it('lets go of the held rows once something else scrolls the viewport', async () => {
      const { fixture, viewport } = await renderAt(0);
      await prepend(fixture);

      viewport.scrollTo({ top: 100 });
      rowHeights.set('m3', 120);
      resize();

      expect(viewport.scrollTop).toBe(100);
    });

    it('does not treat a thread switch as a page, even when the new thread repeats the old first message', async () => {
      options.scrollToBottomOnThreadSwitch.set(false);
      const { fixture, viewport } = await renderAt(100);

      store.threadId.set('b');
      store.messages.set(range(3, 8));
      await settle(fixture);
      resize();

      expect(viewport.scrollTop).toBe(100);
    });
  });

  describe('nxaScrollToBottom', () => {
    it('is disabled at the bottom, scrolls when unpinned, and honors vetoes', async () => {
      const { fixture, viewport, button } = await renderOverflowing();
      expect(button.disabled).toBe(true);
      expect(button.type).toBe('button');

      scrollBy(viewport, 100);
      await fixture.whenStable();
      expect(button.disabled).toBe(false);

      const veto = (event: Event) => event.preventDefault();
      button.addEventListener('click', veto, { capture: true });
      button.click();
      expect(viewport.scrollTop).toBe(100);
      button.removeEventListener('click', veto, { capture: true });

      scrollTo.mockClear();
      button.click();
      expect(scrollTo).toHaveBeenCalledWith({ top: 320, behavior: 'auto' });
      expect(viewport.scrollTop).toBe(220);
      await fixture.whenStable();
      expect(button.disabled).toBe(true);
    });

    it('re-follows content growth after scrolling to the bottom', async () => {
      const { fixture, viewport, button } = await renderOverflowing();
      scrollBy(viewport, 0);
      await fixture.whenStable();

      button.click();
      store.messages.set(range(0, 6));
      await settle(fixture);
      expect(viewport.scrollTop).toBe(380);
    });

    it('is disabled outside a viewport and warns once in dev mode', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      @Component({
        changeDetection: ChangeDetectionStrategy.OnPush,
        imports: [NxaScrollToBottom],
        template: `<button nxaScrollToBottom>Down</button><button nxaScrollToBottom>Down</button>`,
      })
      class Orphan {}

      const fixture = TestBed.createComponent(Orphan);
      await fixture.whenStable();
      const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
      expect([...buttons].every((b) => b.disabled)).toBe(true);
      expect(warn).toHaveBeenCalledOnce();
    });

    it('focuses the thread composer inside the viewport', async () => {
      options.composer.set(true);
      const { fixture, viewport, button } = await renderOverflowing();
      const textarea = viewport.querySelector('textarea')!;
      const outside = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '[data-testid="outside"]',
      )!;
      scrollBy(viewport, 0);
      await fixture.whenStable();
      outside.focus();

      button.click();
      expect(document.activeElement).toBe(textarea);
    });

    it('leaves an edit composer in the viewport unfocused', async () => {
      options.editComposer.set(true);
      const { fixture, viewport, button } = await renderOverflowing();
      const outside = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '[data-testid="outside"]',
      )!;
      expect(viewport.querySelector('[data-testid="edit-composer"]')).not.toBeNull();
      scrollBy(viewport, 0);
      await fixture.whenStable();
      outside.focus();

      button.click();
      expect(document.activeElement).toBe(outside);
    });

    it('leaves the focus alone with focusOnScrollToBottom off', async () => {
      options.composer.set(true);
      options.focusOnScrollToBottom.set(false);
      const { fixture, viewport, button } = await renderOverflowing();
      const outside = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
        '[data-testid="outside"]',
      )!;
      scrollBy(viewport, 0);
      await fixture.whenStable();
      outside.focus();

      button.click();
      expect(document.activeElement).toBe(outside);
    });
  });

  describe('nxaThreadViewportFooter', () => {
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return Number(this.getAttribute('data-height') ?? 0);
      });
    });

    it('registers its height, top margin included, with the viewport', async () => {
      const { fixture, viewport } = await renderOverflowing();
      options.footers.set([{ height: 45, marginTop: 5 }]);
      await settle(fixture);

      scrollBy(viewport, 175);
      await fixture.whenStable();
      expect(atBottom(viewport)).toBe(true);
      scrollBy(viewport, 160);
      await fixture.whenStable();
      expect(atBottom(viewport)).toBe(false);
    });

    it('sums the heights of multiple footers and drops a removed one', async () => {
      const { fixture, viewport } = await renderOverflowing();
      options.footers.set([{ height: 20 }, { height: 30 }]);
      await settle(fixture);

      scrollBy(viewport, 175);
      await fixture.whenStable();
      expect(atBottom(viewport)).toBe(true);

      options.footers.set([{ height: 20 }]);
      await fixture.whenStable();
      viewport.dispatchEvent(new Event('scroll'));
      await fixture.whenStable();
      expect(atBottom(viewport)).toBe(false);

      scrollBy(viewport, 205);
      await fixture.whenStable();
      expect(atBottom(viewport)).toBe(true);

      options.footers.set([]);
      await fixture.whenStable();
      viewport.dispatchEvent(new Event('scroll'));
      await fixture.whenStable();
      expect(atBottom(viewport)).toBe(false);
    });

    it("follows a footer's growth while pinned", async () => {
      const { fixture, viewport } = await renderOverflowing();
      options.footers.set([{ height: 50 }]);
      await settle(fixture);
      const footer = viewport.querySelector<HTMLElement>('[data-testid="footer"]')!;

      scrollTo.mockClear();
      footer.setAttribute('data-height', '80');
      resize(footer);
      expect(scrollTo).toHaveBeenCalledWith({ top: 320, behavior: 'instant' });
    });

    it('follows a footer height reported when the viewport first renders', async () => {
      options.scrollToBottomOnInitialize.set(false);
      options.footers.set([{ height: 50 }]);
      const { viewport } = await render(range(0, 4));

      expect(scrollTo).toHaveBeenCalledWith({ top: 320, behavior: 'instant' });
      expect(viewport.scrollTop).toBe(220);
    });
  });
});
