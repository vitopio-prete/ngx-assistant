import axe from 'axe-core';
import { SimpleTextAttachmentAdapter, type ThreadMessageLike } from '@ngx-assistant/engine';
import {
  button,
  mountThread,
  rows,
  settle,
  slot,
  stubResizeObserver,
  type,
} from '../../testing/thread-harness';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** A store that edits and reloads, so the Edit and Regenerate actions are enabled. */
const editable = { adapter: { onEdit: async () => undefined, onReload: async () => undefined } };

const conversation: ThreadMessageLike[] = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'What is in this picture?' }],
    attachments: [
      {
        id: 'att-1',
        type: 'image',
        name: 'cat.png',
        contentType: 'image/png',
        status: { type: 'complete' },
        content: [{ type: 'image', image: PNG }],
      },
    ],
  },
  {
    role: 'assistant',
    content: [
      { type: 'reasoning', text: 'Looking at the picture.' },
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'describe_image',
        args: { name: 'cat.png' },
        result: 'a cat',
      },
      { type: 'text', text: 'A **cat**, see [the docs](https://angular.dev).' },
    ],
  },
  { role: 'user', content: [{ type: 'text', text: 'Thanks' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'You are welcome.' }] },
];

/** axe on the thread. jsdom renders no layout, so contrast is checked by hand in the preview. */
async function violations(root: HTMLElement) {
  const result = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`,
  );
}

beforeAll(stubResizeObserver);

afterEach(() => {
  document.body.replaceChildren();
});

describe('nxa-thread accessibility', () => {
  it('has no axe violations on an empty thread', async () => {
    const { el, fixture } = await mountThread([]);
    await settle(fixture, () => expect(el.querySelector('textarea')).not.toBeNull());

    expect(await violations(el)).toEqual([]);
  });

  it('has no axe violations on a conversation with every kind of part', async () => {
    const { el, fixture } = await mountThread(conversation);
    await settle(fixture, () => expect(rows(el)).toHaveLength(4));
    slot<HTMLButtonElement>(el, 'reasoning-trigger')!.click();
    slot<HTMLButtonElement>(el, 'tool-fallback-trigger')!.click();
    await settle(fixture, () => expect(slot(el, 'tool-fallback-result')).not.toBeNull());

    expect(await violations(el)).toEqual([]);
  });

  it('has no axe violations on a pending approval with options', async () => {
    const { el, fixture } = await mountThread(
      [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'delete_file',
              args: { path: 'notes.txt' },
              approval: {
                id: 'approval-1',
                prompt: 'Delete notes.txt?',
                options: [
                  { id: 'once', kind: 'allow-once' },
                  { id: 'never', kind: 'reject-once' },
                ],
              },
            },
          ],
        },
      ],
      { adapter: { onRespondToToolApproval: vi.fn() } },
    );
    await settle(fixture, () => expect(el.textContent).toContain('Delete notes.txt?'));

    expect(await violations(el)).toEqual([]);
  });

  it('labels every icon button', async () => {
    const { el, fixture } = await mountThread(conversation);
    await settle(fixture, () => expect(rows(el)).toHaveLength(4));

    const unlabeled = [...el.querySelectorAll('button')].filter(
      (item) => !item.getAttribute('aria-label') && !item.textContent?.trim(),
    );
    expect(unlabeled).toEqual([]);
  });
});

describe('nxa-thread focus', () => {
  it('focuses the composer by default', async () => {
    const { el, fixture } = await mountThread([]);

    await settle(fixture, () =>
      expect(document.activeElement).toBe(el.querySelector('textarea[aria-label="Message"]')),
    );
  });

  it('keeps the page focus when autoFocus is false', async () => {
    const pageControl = document.body.appendChild(document.createElement('button'));
    pageControl.focus();

    const { el, fixture } = await mountThread([], { autoFocus: false });
    await settle(fixture, () => expect(el.querySelector('textarea')).not.toBeNull());

    expect(document.activeElement).toBe(pageControl);
  });

  it('keeps auto-hidden actions in the tab order so the keyboard can reach them', async () => {
    const { el, fixture } = await mountThread(conversation, editable);
    await settle(fixture, () => expect(rows(el)).toHaveLength(4));

    const [first] = rows(el);
    const bar = first!.querySelector<HTMLElement>('[data-nxa-autohidden]');
    expect(bar).not.toBeNull();
    expect(bar!.hidden).toBe(false);
    const edit = bar!.querySelector<HTMLButtonElement>('[aria-label="Edit"]')!;
    expect(edit.disabled).toBe(false);
    expect(edit.tabIndex).toBe(0);

    // A keyboard focus inside the message shows the bar.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    edit.focus();
    await settle(fixture, () => expect(bar!.hasAttribute('data-nxa-autohidden')).toBe(false));
  });

  const approvalCall = (approved?: boolean): ThreadMessageLike => ({
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'delete_file',
        args: { path: 'notes.txt' },
        approval: { id: 'approval-1', ...(approved !== undefined && { approved }) },
      },
      { type: 'text', text: 'Waiting for you.' },
    ],
  });

  const labelled = (root: ParentNode, label: string) =>
    root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

  it('moves the focus to the next control when the focused one is disabled', async () => {
    const onRespondToToolApproval = vi.fn();
    const { el, fixture, update } = await mountThread([approvalCall()], {
      autoFocus: false,
      adapter: { onRespondToToolApproval },
    });
    await settle(fixture, () => expect(el.textContent).toContain('Waiting on tool'));

    const allow = button(el, 'Allow');
    allow.focus();
    allow.click();
    await settle(fixture, () => expect(onRespondToToolApproval).toHaveBeenCalled());

    // The answer locks the controls: the focus goes on to the actions of the message.
    const copy = labelled(rows(el)[0]!, 'Copy');
    await settle(fixture, () => expect(document.activeElement).toBe(copy));

    // The receipt that replaces the controls leaves it there.
    update([approvalCall(true)]);
    await settle(fixture, () => expect(slot(el, 'tool-approval-receipt')).not.toBeNull());
    expect(document.activeElement).toBe(copy);
  });

  it('moves the focus to the control that takes the place of a removed one', async () => {
    const { el, fixture, update } = await mountThread([], {
      autoFocus: false,
      adapter: {
        onCancel: async () => undefined,
        adapters: { attachments: new SimpleTextAttachmentAdapter() },
      },
    });
    await settle(fixture, () => expect(labelled(el, 'Add attachment')).not.toBeNull());
    type(el.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!, 'hi');
    await settle(fixture, () => expect(labelled(el, 'Send').disabled).toBe(false));

    const send = labelled(el, 'Send');
    send.focus();
    update([], { isRunning: true });

    // Send is gone; Stop, after it, takes the focus rather than the attachment button before it.
    await settle(fixture, () => expect(send.isConnected).toBe(false));
    await settle(fixture, () => expect(document.activeElement).toBe(labelled(el, 'Stop')));
  });

  it('leaves alone a focus the user moved out of the thread', async () => {
    const { el, fixture, update } = await mountThread([approvalCall()], {
      autoFocus: false,
      adapter: { onRespondToToolApproval: vi.fn() },
    });
    await settle(fixture, () => expect(el.textContent).toContain('Waiting on tool'));

    const allow = button(el, 'Allow');
    allow.focus();
    allow.blur();
    expect(document.activeElement).toBe(document.body);

    update([approvalCall(true)]);
    await settle(fixture, () => expect(slot(el, 'tool-approval-receipt')).not.toBeNull());
    // The keeper acts once the DOM settles, on the next task.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(document.body);
  });

  it('continues after a removed control rather than jumping to the end', async () => {
    const { el, fixture } = await mountThread(conversation, {
      autoFocus: false,
      ...editable,
    });
    await settle(fixture, () => expect(rows(el)).toHaveLength(4));
    labelled(rows(el)[0]!, 'Edit').click();
    await settle(fixture, () => expect(slot(el, 'edit-composer')).not.toBeNull());

    // Cancel with the pointer: the primitive leaves the focus alone, and the form goes away.
    const cancel = button(el, 'Cancel');
    cancel.focus();
    cancel.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await settle(fixture, () => expect(slot(el, 'edit-composer')).toBeNull());

    // The focus goes on from where the form was: the first control of the next message.
    await settle(fixture, () =>
      expect(document.activeElement).toBe(slot(rows(el)[1]!, 'reasoning-trigger')),
    );
  });
});

describe('nxa-thread messages', () => {
  it('hides the empty attachment wrapper of a user message', async () => {
    const { el, fixture } = await mountThread([
      { role: 'user', content: [{ type: 'text', text: 'Hello again' }] },
    ]);
    await settle(fixture, () => expect(el.textContent).toContain('Hello again'));

    const attachments = slot(el, 'user-message-attachments')!;
    expect(attachments.matches(':empty')).toBe(true);
    expect(attachments.classList.contains('empty:hidden')).toBe(true);
  });

  it('shows the attachments of a user message with an image preview', async () => {
    const { el, fixture } = await mountThread(conversation);
    await settle(fixture, () => expect(rows(el)).toHaveLength(4));

    const attachment = slot(el, 'user-message-attachments')!.querySelector('nxa-attachment')!;
    expect(attachment.textContent).toContain('cat.png');
    expect(attachment.querySelector('img')?.getAttribute('src')).toBe(PNG);
    expect(attachment.querySelector('[aria-label^="Remove"]')).toBeNull();
  });

  it('previews image file parts and names unnamed files by type', async () => {
    const { el, fixture } = await mountThread([
      {
        role: 'assistant',
        content: [
          { type: 'file', mimeType: 'image/png', data: PNG },
          { type: 'file', mimeType: 'text/plain', data: 'aGk=' },
        ],
      },
    ]);
    await settle(fixture, () =>
      expect(el.querySelectorAll('[data-slot="message-file"]')).toHaveLength(2),
    );

    const files = el.querySelectorAll<HTMLElement>('[data-slot="message-file"]');
    expect(files[0]!.querySelector('[data-slot="image-preview"] img')?.getAttribute('src')).toBe(
      PNG,
    );
    expect(files[0]!.querySelector('[data-slot="file-name"]')).toBeNull();
    expect(files[1]!.querySelector('[data-slot="file-name"]')?.textContent).toBe('Text file');
  });

  it('hides the branch picker of a message with one branch', async () => {
    const { el, fixture } = await mountThread(conversation);
    await settle(fixture, () => expect(rows(el)).toHaveLength(4));

    for (const picker of el.querySelectorAll<HTMLElement>('[data-slot="branch-picker"]')) {
      expect(picker.hidden).toBe(true);
    }
  });

  it('shows a check while a copied message is marked copied', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { el, fixture } = await mountThread(conversation);
    await settle(fixture, () => expect(rows(el)).toHaveLength(4));

    const copy = rows(el)[3]!.querySelector<HTMLButtonElement>('[aria-label="Copy"]')!;
    copy.click();

    await settle(fixture, () => expect(writeText).toHaveBeenCalledWith('You are welcome.'));
    await settle(fixture, () => expect(copy.hasAttribute('data-nxa-copied')).toBe(true));
    expect(copy.querySelector('nxa-icon')?.innerHTML).toContain('M5 12.5l4.5 4.5L19 7.5');
  });

  it('shows a writing indicator while a reply has no content yet', async () => {
    const { el, fixture } = await mountThread(
      [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [], status: { type: 'running' } },
      ],
      { isRunning: true },
    );

    await settle(fixture, () =>
      expect(
        slot(el, 'assistant-message')?.querySelector('[role="status"]')?.textContent,
      ).toContain('Writing'),
    );
  });
});
