import type { SpeechSynthesisAdapter, ThreadMessageLike } from '@ngx-assistant/engine';
import { axeViolations } from '../../testing/a11y';
import { mountThread, rows, settle, slot, stubResizeObserver } from '../../testing/thread-harness';
import { keydown, slots, texts } from '../../testing/thread-list-harness';

const conversation: ThreadMessageLike[] = [
  { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }] },
  { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '# Hello\n\nthere' }] },
];

/** A speech adapter whose utterances run until they are cancelled. */
function fakeSpeech() {
  const utterances: (SpeechSynthesisAdapter.Utterance & { cancel: () => void })[] = [];
  const adapter: SpeechSynthesisAdapter = {
    speak: vi.fn(() => {
      const listeners = new Set<() => void>();
      const utterance = {
        status: { type: 'running' } as SpeechSynthesisAdapter.Status,
        cancel: vi.fn(() => {
          utterance.status = { type: 'ended', reason: 'cancelled' };
          for (const listener of [...listeners]) listener();
        }),
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

const assistantRow = (el: HTMLElement) => rows(el)[1]!;
const menuItem = (label: string) =>
  slots(document.body, 'assistant-message-menu-item').find(
    (item) => item.textContent?.trim() === label,
  )!;

async function openMore(fixture: Awaited<ReturnType<typeof mountThread>>['fixture']) {
  const el = fixture.nativeElement as HTMLElement;
  slot(assistantRow(el), 'assistant-message-more')!.click();
  await settle(fixture, () =>
    expect(slots(document.body, 'assistant-message-menu')).toHaveLength(1),
  );
}

beforeAll(stubResizeObserver);

afterEach(() => {
  document.body.replaceChildren();
});

describe('nxa-assistant-message actions', () => {
  it('offers feedback only when the runtime records it', async () => {
    const { el, fixture } = await mountThread(conversation);
    await settle(fixture, () => expect(rows(el)).toHaveLength(2));
    expect(assistantRow(el).querySelector('[aria-label="Helpful"]')).toBeNull();
    expect(assistantRow(el).querySelector('[aria-label="Not helpful"]')).toBeNull();
  });

  it('submits feedback and marks the chosen button pressed', async () => {
    const submit = vi.fn();
    const { el, fixture } = await mountThread(conversation, {
      adapter: { adapters: { feedback: { submit } } },
    });
    await settle(fixture, () => expect(rows(el)).toHaveLength(2));
    const helpful = assistantRow(el).querySelector<HTMLButtonElement>('[aria-label="Helpful"]')!;
    const notHelpful = assistantRow(el).querySelector<HTMLButtonElement>(
      '[aria-label="Not helpful"]',
    )!;
    expect(rows(el)[0]!.querySelector('[aria-label="Helpful"]')).toBeNull();

    helpful.click();
    await settle(fixture, () => expect(helpful.getAttribute('aria-pressed')).toBe('true'));
    expect(notHelpful.getAttribute('aria-pressed')).toBe('false');
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ type: 'positive' }));
  });

  it('exports the message as markdown from the More menu', async () => {
    const exported: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      void (blob as Blob).text().then((text) => exported.push(text));
      return 'blob:message';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { el, fixture } = await mountThread(conversation);
    await settle(fixture, () => expect(rows(el)).toHaveLength(2));
    const more = slot(assistantRow(el), 'assistant-message-more')!;
    expect(more.getAttribute('aria-label')).toBe('More actions');
    expect(more.getAttribute('aria-haspopup')).toBe('menu');

    await openMore(fixture);
    expect(texts(document.body, 'assistant-message-menu-item')).toEqual(['Export as Markdown']);

    menuItem('Export as Markdown').click();
    await vi.waitFor(() => expect(exported).toEqual(['# Hello\n\nthere']));
    await settle(fixture, () =>
      expect(slots(document.body, 'assistant-message-menu')).toHaveLength(0),
    );
  });

  it('reads the message aloud from the More menu and offers to stop', async () => {
    const speech = fakeSpeech();
    const { el, fixture } = await mountThread(conversation, {
      adapter: { adapters: { speech: speech.adapter } },
    });
    await settle(fixture, () => expect(rows(el)).toHaveLength(2));

    await openMore(fixture);
    expect(texts(document.body, 'assistant-message-menu-item')).toEqual([
      'Export as Markdown',
      'Read aloud',
    ]);
    menuItem('Read aloud').click();
    await vi.waitFor(() => expect(speech.adapter.speak).toHaveBeenCalledWith('# Hello\n\nthere'));

    await openMore(fixture);
    expect(texts(document.body, 'assistant-message-menu-item')).toEqual([
      'Export as Markdown',
      'Stop reading',
    ]);
    menuItem('Stop reading').click();
    await vi.waitFor(() => expect(speech.utterances[0]!.cancel).toHaveBeenCalledOnce());
  });

  it('keeps the action bar shown while its menu is open, and opens the menu from the keyboard', async () => {
    const { el, fixture } = await mountThread(conversation);
    await settle(fixture, () => expect(rows(el)).toHaveLength(2));
    const more = slot(assistantRow(el), 'assistant-message-more')!;

    more.focus();
    keydown(more, 'ArrowDown', { keyCode: 40 });
    await settle(fixture, () =>
      expect(document.activeElement).toBe(menuItem('Export as Markdown')),
    );
    expect(more.getAttribute('aria-expanded')).toBe('true');

    keydown(menuItem('Export as Markdown'), 'Escape', { keyCode: 27 });
    await settle(fixture, () => {
      expect(slots(document.body, 'assistant-message-menu')).toHaveLength(0);
      expect(document.activeElement).toBe(more);
    });
  });

  it('has no More menu on a reply without text, where every item would be disabled', async () => {
    const { el, fixture } = await mountThread([
      conversation[0]!,
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'search', args: {} }],
      },
    ]);
    await settle(fixture, () => expect(rows(el)).toHaveLength(2));
    expect(slot(assistantRow(el), 'assistant-message-more')).toBeNull();
    expect(assistantRow(el).querySelector('[aria-label="Regenerate"]')).not.toBeNull();
  });

  it('has no axe violations with feedback and the open menu', async () => {
    const { el, fixture } = await mountThread(conversation, {
      adapter: { adapters: { feedback: { submit: vi.fn() } } },
    });
    await settle(fixture, () => expect(rows(el)).toHaveLength(2));
    expect(await axeViolations(el)).toEqual([]);

    await openMore(fixture);
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
