import { provideSuggestions } from '@ngx-assistant/angular';
import type { ThreadMessageLike } from '@ngx-assistant/engine';
import { axeViolations } from '../../testing/a11y';
import { mountThread, settle, slot, stubResizeObserver, type } from '../../testing/thread-harness';

const suggestions = provideSuggestions([
  { title: 'Plan a trip', label: 'for a weekend', prompt: 'Plan a weekend trip' },
  'What can you do?',
]);

const userMessage: ThreadMessageLike = { role: 'user', content: [{ type: 'text', text: 'hi' }] };
const assistantMessage: ThreadMessageLike = {
  role: 'assistant',
  content: [{ type: 'text', text: 'hello' }],
};

const field = (root: ParentNode) =>
  root.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;
const footer = (root: ParentNode) => slot(root, 'thread-viewport-footer')!;
const welcome = (root: ParentNode) => slot(root, 'thread-welcome');
const suggestionList = (root: ParentNode) => slot(root, 'thread-welcome-suggestions');
const precedes = (a: Node, b: Node) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

/** Stubs the footer's position (old layout, then new) and its animation. */
function stubFooterMotion(el: HTMLElement, tops: number[]) {
  const target = footer(el);
  const rect = vi.spyOn(target, 'getBoundingClientRect');
  for (const top of tops) rect.mockReturnValueOnce({ top } as DOMRect);
  rect.mockReturnValue({ top: tops.at(-1) ?? 0 } as DOMRect);
  const animate = vi.fn();
  target.animate = animate as unknown as typeof target.animate;
  return animate;
}

beforeAll(stubResizeObserver);

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('nxa-thread welcome layout', () => {
  it('centers the composer by default: greeting, composer, then the suggestions as a list', async () => {
    const { el, fixture } = await mountThread([], { providers: [suggestions] });

    await settle(fixture, () =>
      expect(suggestionList(el)?.querySelectorAll('button')).toHaveLength(2),
    );
    const root = el.querySelector<HTMLElement>('[data-welcome-layout]')!;
    expect(root.dataset['welcomeLayout']).toBe('centered');
    expect(root.hasAttribute('data-empty')).toBe(true);
    expect(welcome(el)!.dataset['align']).toBe('start');
    expect(suggestionList(el)!.dataset['variant']).toBe('list');
    expect(precedes(welcome(el)!, field(el))).toBe(true);
    expect(precedes(field(el), suggestionList(el)!)).toBe(true);
    expect(footer(el).classList.contains('sticky')).toBe(false);
    const [described, bare] = [...suggestionList(el)!.querySelectorAll('button')];
    expect(described!.textContent!.trim()).toBe('Plan a trip for a weekend');
    expect(bare!.textContent!.trim()).toBe('What can you do?');
  });

  it('keeps the same field and its draft when welcomeLayout changes', async () => {
    const { el, fixture, setWelcomeLayout } = await mountThread([], { providers: [suggestions] });
    await settle(fixture, () => expect(suggestionList(el)).not.toBeNull());
    const textarea = field(el);
    textarea.focus();
    type(textarea, 'a draft');

    setWelcomeLayout('bottom');
    await settle(fixture, () => expect(footer(el).classList.contains('sticky')).toBe(true));
    expect(field(el)).toBe(textarea);
    expect(textarea.value).toBe('a draft');
    expect(document.activeElement).toBe(textarea);
  });

  it('hides the suggestions while the field has text, and shows them again when cleared', async () => {
    const { el, fixture } = await mountThread([], { providers: [suggestions] });
    await settle(fixture, () => expect(suggestionList(el)).not.toBeNull());

    type(field(el), 'Hello');
    await settle(fixture, () => expect(suggestionList(el)).toBeNull());
    type(field(el), '');
    await settle(fixture, () => expect(suggestionList(el)).not.toBeNull());
  });

  it('keeps the same composer, its draft and the focus when the first message arrives', async () => {
    const { el, fixture, update } = await mountThread([], { providers: [suggestions] });
    await settle(fixture, () => expect(suggestionList(el)).not.toBeNull());
    const textarea = field(el);
    textarea.focus();
    type(textarea, 'a draft');

    update([userMessage]);
    await settle(fixture, () => expect(footer(el).classList.contains('sticky')).toBe(true));
    expect(field(el)).toBe(textarea);
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value).toBe('a draft');
    expect(welcome(el)).toBeNull();
    expect(suggestionList(el)).toBeNull();
    expect(footer(el).classList.contains('mt-auto')).toBe(true);
    expect(el.querySelector('[data-welcome-layout]')!.hasAttribute('data-empty')).toBe(false);
  });

  it('goes back to the centered layout when the thread is empty again', async () => {
    const { el, fixture, update } = await mountThread([userMessage, assistantMessage], {
      providers: [suggestions],
    });
    await settle(fixture, () => expect(footer(el).classList.contains('sticky')).toBe(true));

    update([]);
    await settle(fixture, () => expect(footer(el).classList.contains('sticky')).toBe(false));
    expect(welcome(el)).not.toBeNull();
    expect(precedes(field(el), suggestionList(el)!)).toBe(true);
  });

  it('keeps the composer at the bottom with welcomeLayout="bottom", the suggestions as cards', async () => {
    const { el, fixture } = await mountThread([], {
      welcomeLayout: 'bottom',
      providers: [suggestions],
    });

    await settle(fixture, () => expect(suggestionList(el)).not.toBeNull());
    expect(el.querySelector<HTMLElement>('[data-welcome-layout]')!.dataset['welcomeLayout']).toBe(
      'bottom',
    );
    expect(welcome(el)!.dataset['align']).toBe('center');
    expect(suggestionList(el)!.dataset['variant']).toBe('grid');
    expect(welcome(el)!.contains(suggestionList(el))).toBe(true);
    expect(precedes(suggestionList(el)!, field(el))).toBe(true);
    expect(footer(el).classList.contains('sticky')).toBe(true);

    type(field(el), 'Hello');
    await fixture.whenStable();
    expect(suggestionList(el)).not.toBeNull();
  });

  it('slides the composer from the middle to the bottom on the first message', async () => {
    const { el, fixture, update } = await mountThread([]);
    await fixture.whenStable();
    const animate = stubFooterMotion(el, [300, 640]);

    update([userMessage]);
    await settle(fixture, () => expect(animate).toHaveBeenCalledTimes(1));
    const [keyframes, options] = animate.mock.calls[0]!;
    expect(keyframes).toEqual([{ translate: '0 -340px' }, { translate: '0 0' }]);
    expect(options).toMatchObject({ duration: 250 });
  });

  it('does not animate when the composer did not move', async () => {
    const { el, fixture, update } = await mountThread([]);
    await fixture.whenStable();
    const animate = stubFooterMotion(el, [640, 640.5]);

    update([userMessage]);
    await settle(fixture, () => expect(footer(el).classList.contains('sticky')).toBe(true));
    await fixture.whenStable();
    expect(animate).not.toHaveBeenCalled();
  });

  it('does not slide when the user prefers reduced motion', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }));
    const { el, fixture, update } = await mountThread([]);
    await fixture.whenStable();
    const animate = stubFooterMotion(el, [300, 640]);

    update([userMessage]);
    await settle(fixture, () => expect(footer(el).classList.contains('sticky')).toBe(true));
    expect(animate).not.toHaveBeenCalled();
  });

  it('does not slide with welcomeLayout="bottom", nor when a thread opens with its messages', async () => {
    const bottom = await mountThread([], { welcomeLayout: 'bottom' });
    await bottom.fixture.whenStable();
    const bottomAnimate = stubFooterMotion(bottom.el, [640, 640]);
    bottom.update([userMessage]);
    await settle(bottom.fixture, () =>
      expect(slot(bottom.el, 'thread-messages')!.children).toHaveLength(1),
    );
    expect(bottomAnimate).not.toHaveBeenCalled();
    document.body.replaceChildren();

    const opened = await mountThread([]);
    await opened.fixture.whenStable();
    const openedAnimate = stubFooterMotion(opened.el, [300, 640]);
    opened.update([userMessage, assistantMessage]);
    await settle(opened.fixture, () =>
      expect(footer(opened.el).classList.contains('sticky')).toBe(true),
    );
    expect(openedAnimate).not.toHaveBeenCalled();
  });

  it.each(['centered', 'bottom'] as const)(
    'has no axe violations on an empty thread with welcomeLayout="%s"',
    async (welcomeLayout) => {
      const { el, fixture } = await mountThread([], { welcomeLayout, providers: [suggestions] });
      await settle(fixture, () => expect(suggestionList(el)).not.toBeNull());
      expect(await axeViolations(el)).toEqual([]);
    },
  );
});
