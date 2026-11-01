import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { injectAssistant } from '@ngx-assistant/angular';
import type { RemoteThreadListAdapter } from '@ngx-assistant/engine';
import { axeViolations } from '../../testing/a11y';
import { stubResizeObserver } from '../../testing/thread-harness';
import {
  keydown,
  makeAdapter,
  mountWithThreads,
  slots,
  texts,
  until,
  withTitles,
} from '../../testing/thread-list-harness';
import { NxaAssistantModal } from './assistant-modal';
import { MODAL_SIZE_STORAGE_KEY } from './modal-size';

let fixture: ComponentFixture<NxaAssistantModal>;

const renderModal = async (adapter: RemoteThreadListAdapter) => {
  ({ fixture } = (await mountWithThreads(adapter, NxaAssistantModal)) as {
    fixture: ComponentFixture<NxaAssistantModal>;
  });
};

const part = (name: string) =>
  document.body.querySelector<HTMLElement>(`[data-slot="assistant-modal-${name}"]`);

const itemTitles = () => texts(document.body, 'thread-list-item-title');

const itemTrigger = (title: string) =>
  slots(document.body, 'thread-list-item-trigger').find(
    (node) => node.textContent?.trim() === title,
  )!;

const settle = (assert: () => void) => until(fixture, assert);

const toggleModal = () => part('button')!.click();

const openModal = async () => {
  toggleModal();
  await settle(() => expect(part('header')).toBeTruthy());
};

const threadsToggle = () => part('threads') as HTMLButtonElement;

const openThreadList = async () => {
  await settle(() => expect(threadsToggle().disabled).toBe(false));
  threadsToggle().click();
  await settle(() => expect(part('thread-list')).toBeTruthy());
};

const contentSize = () => {
  const { width, height } = part('content')!.style;
  return { width, height };
};

const renderedAt = (width: number, height: number) =>
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const { style } = this as HTMLElement;
    const w = Number.parseFloat(style.width) || width;
    const h = Number.parseFloat(style.height) || height;
    return { width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0 } as DOMRect;
  });

class StubPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

const pointer = (target: Element, type: string, init: PointerEventInit) =>
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...init }),
  );

/** Applies the signal writes of the handlers to the DOM. */
const render = () => {
  fixture.detectChanges();
  return fixture.whenStable();
};

beforeAll(() => {
  stubResizeObserver();
  globalThis.PointerEvent ??= StubPointerEvent as never;
  if (!('setPointerCapture' in Element.prototype)) {
    Object.assign(Element.prototype, { setPointerCapture: () => undefined });
  }
});

afterEach(() => {
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('nxa-assistant-modal', () => {
  it('opens on the thread, named by its title, with the threads toggle disabled while nothing is listed', async () => {
    await renderModal(makeAdapter([]));
    expect(part('button')!.getAttribute('aria-label')).toBe('Open Assistant');
    expect(part('button')!.getAttribute('aria-expanded')).toBe('false');
    await openModal();

    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(
      document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent?.trim(),
    ).toBe('New Chat');
    expect(part('button')!.getAttribute('aria-label')).toBe('Close Assistant');
    expect(part('button')!.getAttribute('aria-expanded')).toBe('true');
    expect(part('button')!.getAttribute('aria-controls')).toBe(dialog.id);
    expect(threadsToggle().disabled).toBe(true);
    expect(threadsToggle().getAttribute('aria-pressed')).toBe('false');
    expect(part('thread-list')).toBeNull();
    expect(part('thread')!.querySelector('textarea')).toBeTruthy();
  });

  it('lists the threads behind the threads toggle and opens the picked one', async () => {
    const adapter = makeAdapter(withTitles('Trip planning', 'Budget review'));
    await renderModal(adapter);
    await openModal();
    await openThreadList();

    expect(part('title')!.textContent?.trim()).toBe('Threads');
    expect(threadsToggle().getAttribute('aria-pressed')).toBe('true');
    expect(part('thread')!.inert).toBe(true);
    await settle(() => expect(itemTitles()).toEqual(['Trip planning', 'Budget review']));

    itemTrigger('Budget review').focus();
    itemTrigger('Budget review').click();
    await settle(() => expect(part('title')!.textContent?.trim()).toBe('Budget review'));
    expect(part('thread-list')).toBeNull();
    expect(part('thread')!.inert).toBe(false);
    expect(threadsToggle().getAttribute('aria-pressed')).toBe('false');
    // The picked thread's composer takes the focus, as on any thread switch.
    await settle(() =>
      expect(document.activeElement).toBe(part('thread')!.querySelector('textarea')),
    );
  });

  it('puts the focus on the title when a view change leaves it nowhere', async () => {
    await renderModal(makeAdapter(withTitles('Trip planning')));
    await openModal();
    threadsToggle().focus();
    await openThreadList();
    // The toggle keeps the focus: the title does not take it.
    expect(document.activeElement).toBe(threadsToggle());

    (document.activeElement as HTMLElement).blur();
    threadsToggle().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle(() => expect(part('thread-list')).toBeNull());
    await settle(() => expect(document.activeElement).toBe(part('title')));
  });

  it('returns to the conversation when the threads toggle is pressed again', async () => {
    await renderModal(makeAdapter(withTitles('Trip planning')));
    await openModal();
    await openThreadList();

    threadsToggle().click();
    await settle(() => expect(part('thread-list')).toBeNull());
    expect(part('title')!.textContent?.trim()).toBe('New Chat');
    expect(threadsToggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the title in place across both views', async () => {
    await renderModal(makeAdapter(withTitles('Trip planning')));
    await openModal();
    const header = part('header')!;
    const titleIndex = () => [...header.children].indexOf(part('title')!);

    expect(titleIndex()).toBe(0);
    await openThreadList();
    expect(titleIndex()).toBe(0);
  });

  it('starts a new thread from the list', async () => {
    await renderModal(makeAdapter(withTitles('Trip planning')));
    await openModal();
    await openThreadList();
    itemTrigger('Trip planning').click();
    await settle(() => expect(part('title')!.textContent?.trim()).toBe('Trip planning'));
    await openThreadList();

    part('new')!.click();
    await settle(() => expect(part('thread-list')).toBeNull());
    await settle(() => expect(part('title')!.textContent?.trim()).toBe('New Chat'));
  });

  it('reopens on the thread after closing from the list', async () => {
    await renderModal(makeAdapter(withTitles('Trip planning')));
    await openModal();
    await openThreadList();

    toggleModal();
    await settle(() => expect(part('header')).toBeNull());
    await openModal();
    expect(part('thread-list')).toBeNull();
    expect(part('title')!.textContent?.trim()).toBe('New Chat');
  });

  it('stays open on a click outside, closes on Escape and gives the focus back to the button', async () => {
    await renderModal(makeAdapter(withTitles('Trip planning')));
    await openModal();
    await settle(() => expect(part('content')!.contains(document.activeElement)).toBe(true));

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await render();
    expect(part('content')).toBeTruthy();

    keydown(document.activeElement!, 'Escape', { keyCode: 27 });
    await settle(() => expect(part('content')).toBeNull());
    expect(document.activeElement).toBe(part('button'));
  });

  it('ignores Escape from the page around it and during an IME composition', async () => {
    await renderModal(makeAdapter(withTitles('Trip planning')));
    const outside = document.body.appendChild(document.createElement('input'));
    await openModal();

    outside.focus();
    keydown(outside, 'Escape', { keyCode: 27 });
    await render();
    expect(part('content')).toBeTruthy();

    const composer = part('thread')!.querySelector('textarea')!;
    composer.focus();
    keydown(composer, 'Escape', { isComposing: true });
    keydown(composer, 'Escape', { keyCode: 229 });
    await render();
    expect(part('content')).toBeTruthy();

    keydown(composer, 'Escape', { keyCode: 27 });
    await settle(() => expect(part('content')).toBeNull());
  });

  it('shows the thread when the open thread is picked again', async () => {
    await renderModal(makeAdapter(withTitles('Trip planning')));
    await openModal();
    await openThreadList();
    itemTrigger('Trip planning').click();
    await settle(() => expect(part('title')!.textContent?.trim()).toBe('Trip planning'));
    await openThreadList();

    itemTrigger('Trip planning').click();
    await settle(() => expect(part('thread-list')).toBeNull());
  });

  it('leaves Escape to an open menu inside it', async () => {
    await renderModal(makeAdapter(withTitles('Trip planning')));
    await openModal();
    await openThreadList();
    await settle(() => expect(slots(document.body, 'thread-list-item-more')).toHaveLength(1));
    const more = slots(document.body, 'thread-list-item-more')[0]!;
    more.focus();
    keydown(more, 'ArrowDown', { keyCode: 40 });
    await settle(() => expect(slots(document.body, 'thread-list-item-menu')).toHaveLength(1));

    keydown(document.activeElement!, 'Escape', { keyCode: 27 });
    await settle(() => expect(slots(document.body, 'thread-list-item-menu')).toHaveLength(0));
    expect(part('content')).toBeTruthy();
  });

  it('opens by itself on the thread when a reply starts', async () => {
    await renderModal(makeAdapter(withTitles('Trip planning')));
    const assistant = runInInjectionContext(TestBed.inject(EnvironmentInjector), () =>
      injectAssistant(),
    );

    assistant.thread.append('Hello');
    await settle(() => expect(part('content')).toBeTruthy());
    expect(part('thread-list')).toBeNull();
  });

  it('resizes from the top start corner and remembers the size', async () => {
    renderedAt(400, 500);
    await renderModal(makeAdapter([]));
    await openModal();
    const handle = part('resize-handle')!;

    pointer(handle, 'pointerdown', { button: 0, clientX: 300, clientY: 300 });
    pointer(handle, 'pointermove', { clientX: 260, clientY: 240 });
    await render();
    expect(contentSize()).toEqual({ width: '440px', height: '560px' });
    expect(window.localStorage.getItem(MODAL_SIZE_STORAGE_KEY)).toBeNull();

    pointer(handle, 'pointerup', { clientX: 250, clientY: 230 });
    await render();
    expect(contentSize()).toEqual({ width: '450px', height: '570px' });
    expect(JSON.parse(window.localStorage.getItem(MODAL_SIZE_STORAGE_KEY)!)).toEqual({
      width: 450,
      height: 570,
    });
  });

  it('keeps the default size when the handle is clicked without a drag', async () => {
    renderedAt(400, 500);
    await renderModal(makeAdapter([]));
    await openModal();
    const handle = part('resize-handle')!;

    pointer(handle, 'pointerdown', { button: 0, clientX: 300, clientY: 300 });
    pointer(handle, 'pointerup', { clientX: 300, clientY: 300 });
    await render();

    expect(contentSize()).toEqual({ width: '', height: '' });
    expect(window.localStorage.getItem(MODAL_SIZE_STORAGE_KEY)).toBeNull();
  });

  it('resizes from the keyboard and resets with Enter', async () => {
    renderedAt(400, 500);
    await renderModal(makeAdapter([]));
    await openModal();
    const handle = part('resize-handle')!;

    keydown(handle, 'ArrowUp', { shiftKey: true });
    await render();
    expect(contentSize()).toEqual({ width: '400px', height: '564px' });
    keydown(handle, 'ArrowLeft');
    await render();
    expect(contentSize()).toEqual({ width: '416px', height: '564px' });
    expect(JSON.parse(window.localStorage.getItem(MODAL_SIZE_STORAGE_KEY)!)).toEqual({
      width: 416,
      height: 564,
    });
    keydown(handle, 'Enter');
    await render();
    expect(contentSize()).toEqual({ width: '', height: '' });
    expect(window.localStorage.getItem(MODAL_SIZE_STORAGE_KEY)).toBeNull();
  });

  it('restores a remembered size within the viewport and resets it on double click', async () => {
    window.localStorage.setItem(
      MODAL_SIZE_STORAGE_KEY,
      JSON.stringify({ width: 5000, height: 200 }),
    );
    await renderModal(makeAdapter([]));
    await openModal();
    expect(contentSize()).toEqual({ width: `${window.innerWidth - 32}px`, height: '400px' });

    part('resize-handle')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await render();
    expect(contentSize()).toEqual({ width: '', height: '' });
    expect(window.localStorage.getItem(MODAL_SIZE_STORAGE_KEY)).toBeNull();
  });

  it('has no axe violations in either view', async () => {
    await renderModal(makeAdapter(withTitles('Trip planning')));
    expect(await axeViolations(document.body)).toEqual([]);
    await openModal();
    expect(await axeViolations(document.body)).toEqual([]);
    await openThreadList();
    await settle(() => expect(itemTitles()).toEqual(['Trip planning']));
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
