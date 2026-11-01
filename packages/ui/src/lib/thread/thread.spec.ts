import type { ThreadMessageLike, ToolCallMessagePart } from '@ngx-assistant/engine';
import {
  button,
  buttons,
  mountThread,
  rows,
  scrollableViewport,
  settle,
  slot,
  stubResizeObserver,
  type,
} from '../../testing/thread-harness';

const pendingApproval = (
  approval: Omit<NonNullable<ToolCallMessagePart['approval']>, 'id'> = {},
): ThreadMessageLike => ({
  role: 'assistant',
  content: [
    {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'delete_file',
      args: { path: 'notes.txt' },
      approval: { id: 'approval-1', ...approval },
    },
  ],
});

const answerField = (root: ParentNode, label: string) =>
  root.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`);

beforeAll(stubResizeObserver);

afterEach(() => {
  document.body.replaceChildren();
});

describe('nxa-thread', () => {
  it('greets on an empty thread and composes a send-capable composer', async () => {
    const { el, fixture } = await mountThread([]);

    await settle(fixture, () => expect(el.textContent).toContain('How can I help you today?'));
    expect(el.querySelector('textarea[aria-label="Message"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Send"]')).not.toBeNull();
    expect(el.querySelector('[aria-label="Stop"]')).toBeNull();
  });

  it('swaps send for stop while the thread runs, and stops the run', async () => {
    const onCancel = vi.fn(async () => undefined);
    const { el, fixture } = await mountThread([], { isRunning: true, adapter: { onCancel } });

    await settle(fixture, () => expect(el.querySelector('[aria-label="Stop"]')).not.toBeNull());
    expect(el.querySelector('[aria-label="Send"]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[aria-label="Stop"]')!.click();
    await settle(fixture, () => expect(onCancel).toHaveBeenCalled());
  });

  it('drops the greeting and renders a row per message role', async () => {
    const { el, fixture } = await mountThread([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ]);

    await settle(fixture, () => expect(rows(el)).toHaveLength(2));
    expect(rows(el).map((row) => row.dataset['role'])).toEqual(['user', 'assistant']);
    expect(el.textContent).not.toContain('How can I help you today?');
  });

  it('renders assistant text as markdown and user text verbatim', async () => {
    const { el, fixture } = await mountThread([
      { role: 'user', content: [{ type: 'text', text: '**not bold**' }] },
      { role: 'assistant', content: [{ type: 'text', text: '**bold**' }] },
    ]);

    await settle(fixture, () => expect(rows(el)).toHaveLength(2));
    const [user, assistant] = rows(el);
    expect(assistant!.querySelector('strong')?.textContent).toBe('bold');
    expect(user!.querySelector('strong')).toBeNull();
    expect(user!.textContent).toContain('**not bold**');
  });

  it('escapes raw HTML in assistant markdown instead of rendering it', async () => {
    const { el, fixture } = await mountThread([
      { role: 'assistant', content: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] },
    ]);

    await settle(fixture, () => expect(rows(el)).toHaveLength(1));
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('opens markdown links in a new tab without handing over the opener', async () => {
    const { el, fixture } = await mountThread([
      { role: 'assistant', content: [{ type: 'text', text: 'see https://angular.dev' }] },
    ]);

    await settle(fixture, () => expect(el.querySelector('.nxa-md a')).not.toBeNull());
    const link = el.querySelector<HTMLAnchorElement>('.nxa-md a')!;
    expect(link.getAttribute('href')).toBe('https://angular.dev');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('drops unsafe link targets and shows markdown images as links', async () => {
    const { el, fixture } = await mountThread([
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '[click](javascript:alert(1)) ![secret](https://example.com/track.png)',
          },
        ],
      },
    ]);

    await settle(fixture, () => expect(el.querySelector('.nxa-md')).not.toBeNull());
    const md = el.querySelector('.nxa-md')!;
    expect(md.querySelector('a[href^="javascript"]')).toBeNull();
    expect(md.querySelector('img')).toBeNull();
    expect(md.querySelector('a[href="https://example.com/track.png"]')?.textContent).toBe('secret');
  });

  it('surfaces the error of an assistant message that failed', async () => {
    const { el, fixture } = await mountThread([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'partial' }],
        status: {
          type: 'incomplete',
          reason: 'error',
          error: { code: 'unknown', message: 'model unavailable' },
        },
      },
    ]);

    await settle(fixture, () => expect(el.textContent).toContain('model unavailable'));
    expect(el.textContent).not.toContain('[object Object]');
    expect(slot(el, 'message-error')?.getAttribute('role')).toBe('alert');
  });

  it('offers edit only on user rows and regenerate only on assistant rows', async () => {
    const { el, fixture } = await mountThread([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ]);

    await settle(fixture, () => expect(rows(el)).toHaveLength(2));
    const [user, assistant] = rows(el);
    expect(user!.querySelector('[aria-label="Edit"]')).not.toBeNull();
    expect(user!.querySelector('[aria-label="Regenerate"]')).toBeNull();
    expect(assistant!.querySelector('[aria-label="Regenerate"]')).not.toBeNull();
    expect(assistant!.querySelector('[aria-label="Edit"]')).toBeNull();
    expect(user!.querySelector('[aria-label="Copy"]')).not.toBeNull();
  });

  it('swaps a user message for its edit form, focused, and back on cancel', async () => {
    const { el, fixture } = await mountThread(
      [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      ],
      { adapter: { onEdit: async () => undefined } },
    );

    await settle(fixture, () => expect(rows(el)).toHaveLength(2));
    rows(el)[0]!.querySelector<HTMLButtonElement>('[aria-label="Edit"]')!.click();

    await settle(fixture, () => expect(answerField(el, 'Edit message')).not.toBeNull());
    expect(answerField(el, 'Edit message')!.value).toBe('hi');
    expect(document.activeElement).toBe(answerField(el, 'Edit message'));
    button(el, 'Cancel').click();

    await settle(fixture, () => expect(answerField(el, 'Edit message')).toBeNull());
    expect(slot(el, 'user-message')?.textContent).toContain('hi');
  });

  it('renders an unregistered tool call through the fallback with its args and result', async () => {
    const { el, fixture } = await mountThread([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'get_weather',
            args: { city: 'sf' },
            result: { temperature: 72 },
          },
        ],
      },
    ]);

    await settle(fixture, () => expect(el.textContent).toContain('Used tool: get_weather'));
    expect(slot(el, 'tool-fallback-args')).toBeNull();
    const trigger = slot<HTMLButtonElement>(el, 'tool-fallback-trigger')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    trigger.click();

    await settle(fixture, () =>
      expect(slot(el, 'tool-fallback-args')?.textContent).toBe('{"city":"sf"}'),
    );
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(slot(el, 'tool-fallback-result')?.textContent).toContain('"temperature": 72');
  });

  it('locks the thread viewport while the tool fallback toggles', async () => {
    const { el, fixture } = await mountThread([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'get_weather',
            args: { city: 'sf' },
            result: 'sunny',
          },
        ],
      },
    ]);
    const viewport = scrollableViewport(el);

    await settle(fixture, () => expect(slot(el, 'tool-fallback-trigger')).not.toBeNull());
    viewport.scrollTop = 120;
    slot<HTMLButtonElement>(el, 'tool-fallback-trigger')!.click();
    expect(viewport.style.scrollbarWidth).toBe('none');
    viewport.scrollTop = 80;
    viewport.dispatchEvent(new Event('scroll'));
    expect(viewport.scrollTop).toBe(120);

    await settle(fixture, () =>
      expect(slot(el, 'tool-fallback-trigger')!.getAttribute('data-state')).toBe('open'),
    );
    viewport.scrollTop = 160;
    slot<HTMLButtonElement>(el, 'tool-fallback-trigger')!.click();
    viewport.scrollTop = 80;
    viewport.dispatchEvent(new Event('scroll'));
    expect(viewport.scrollTop).toBe(160);

    fixture.destroy();
    expect(viewport.style.scrollbarWidth).toBe('');
  });

  it('opens a tool call awaiting approval and answers it from the fallback', async () => {
    const onRespondToToolApproval = vi.fn();
    const { el, fixture } = await mountThread([pendingApproval()], {
      adapter: { onRespondToToolApproval },
    });

    await settle(fixture, () => expect(el.textContent).toContain('Waiting on tool: delete_file'));
    button(el, 'Allow').click();

    await settle(fixture, () => expect(onRespondToToolApproval).toHaveBeenCalled());
    expect(onRespondToToolApproval.mock.calls[0]![0]).toMatchObject({
      approvalId: 'approval-1',
      approved: true,
    });
    await settle(fixture, () => expect(button(el, 'Deny').disabled).toBe(true));
  });

  it('confirms a declared approval option before answering with it', async () => {
    const onRespondToToolApproval = vi.fn();
    const { el, fixture } = await mountThread(
      [
        pendingApproval({
          options: [
            { id: 'once', kind: 'allow-once' },
            { id: 'always', kind: 'allow-always', confirm: true },
            { id: 'never', kind: 'reject-once' },
          ],
        }),
      ],
      { adapter: { onRespondToToolApproval } },
    );

    await settle(fixture, () => expect(button(el, 'Always allow')).toBeDefined());
    expect(buttons(el).filter((item) => item.textContent?.trim() === 'Deny')).toHaveLength(1);
    button(el, 'Always allow').click();

    await settle(fixture, () => expect(el.textContent).toContain('Always allow?'));
    expect(onRespondToToolApproval).not.toHaveBeenCalled();
    button(el, 'Confirm').click();

    await settle(fixture, () => expect(onRespondToToolApproval).toHaveBeenCalled());
    expect(onRespondToToolApproval.mock.calls[0]![0]).toMatchObject({
      approvalId: 'approval-1',
      optionId: 'always',
    });
  });

  it('gives a later interrupt on the same call fresh controls', async () => {
    const onResumeToolCall = vi.fn();
    const toolCall = (interrupt?: string): ThreadMessageLike => ({
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'confirm_step',
          args: {},
          ...(interrupt && { interrupt: { type: 'human' as const, payload: interrupt } }),
        },
      ],
    });
    const { el, fixture, update } = await mountThread([toolCall('first')], {
      adapter: { onResumeToolCall },
    });

    await settle(fixture, () => expect(button(el, 'Allow').disabled).toBe(false));
    button(el, 'Allow').click();
    await settle(fixture, () => expect(onResumeToolCall).toHaveBeenCalledTimes(1));
    await settle(fixture, () => expect(button(el, 'Allow').disabled).toBe(true));

    update([toolCall()], { isRunning: true });
    await settle(fixture, () => expect(el.textContent).toContain('Running tool: confirm_step'));

    update([toolCall('second')]);
    await settle(fixture, () => expect(button(el, 'Allow').disabled).toBe(false));
  });

  it('allows a call waiting on the user without a request, with a result', async () => {
    const onAddToolResult = vi.fn();
    const { el, fixture } = await mountThread(
      [
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'ask_user', args: {} }],
        },
      ],
      { adapter: { onAddToolResult } },
    );

    await settle(fixture, () => expect(button(el, 'Allow').disabled).toBe(false));
    button(el, 'Deny').click();

    await settle(fixture, () => expect(onAddToolResult).toHaveBeenCalled());
    expect(onAddToolResult.mock.calls[0]![0]).toMatchObject({
      toolCallId: 'call-1',
      result: 'User denied tool execution',
    });
    await settle(fixture, () => expect(button(el, 'Allow').disabled).toBe(true));
  });

  it('gives the buttons back with the reason when the runtime refuses the answer', async () => {
    const { el, fixture } = await mountThread([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'ask_user', args: {} }],
      },
    ]);

    await settle(fixture, () => expect(button(el, 'Allow').disabled).toBe(false));
    button(el, 'Allow').click();

    await settle(fixture, () =>
      expect(slot(el, 'tool-fallback-content')?.querySelector('[role="alert"]')).not.toBeNull(),
    );
    expect(button(el, 'Allow').disabled).toBe(false);
  });

  it('sends a free-form answer to a text request', async () => {
    const onRespondToToolApproval = vi.fn();
    const { el, fixture } = await mountThread(
      [pendingApproval({ prompt: 'Which branch?', display: 'text' })],
      { adapter: { onRespondToToolApproval } },
    );

    await settle(fixture, () => expect(answerField(el, 'Which branch?')).not.toBeNull());
    expect(buttons(el).some((item) => item.textContent?.trim() === 'Deny')).toBe(false);
    type(answerField(el, 'Which branch?')!, 'release');
    await fixture.whenStable();
    button(el, 'Send').click();

    await settle(fixture, () => expect(onRespondToToolApproval).toHaveBeenCalled());
    expect(onRespondToToolApproval.mock.calls[0]![0]).toMatchObject({
      approvalId: 'approval-1',
      text: 'release',
    });
  });

  it('answers every question of a questionnaire together', async () => {
    const onRespondToToolApproval = vi.fn();
    const { el, fixture } = await mountThread(
      [
        pendingApproval({
          display: 'questions',
          questions: [
            {
              id: 'env',
              prompt: 'Which environment?',
              options: [
                { id: 'prod', label: 'Production' },
                { id: 'dev', label: 'Development' },
              ],
            },
            { id: 'why', prompt: 'Why now?' },
          ],
        }),
      ],
      { adapter: { onRespondToToolApproval } },
    );

    await settle(fixture, () => expect(button(el, 'Production')).toBeDefined());
    expect(button(el, 'Send').disabled).toBe(true);
    button(el, 'Production').click();
    type(answerField(el, 'Why now?')!, 'hotfix');

    await settle(fixture, () => expect(button(el, 'Send').disabled).toBe(false));
    expect(button(el, 'Production').getAttribute('aria-pressed')).toBe('true');
    button(el, 'Send').click();

    await settle(fixture, () => expect(onRespondToToolApproval).toHaveBeenCalled());
    expect(onRespondToToolApproval.mock.calls[0]![0]).toMatchObject({
      approvalId: 'approval-1',
      answers: { env: { optionIds: ['prod'] }, why: { text: 'hotfix' } },
    });
  });

  it('dismisses a dismissible question without an answer', async () => {
    const onRespondToToolApproval = vi.fn();
    const { el, fixture } = await mountThread(
      [
        pendingApproval({
          prompt: 'Pick a target',
          display: 'select',
          dismissible: true,
          options: [{ id: 'staging', kind: '_target', label: 'Staging' }],
        }),
      ],
      { adapter: { onRespondToToolApproval } },
    );

    await settle(fixture, () => expect(button(el, 'Dismiss')).toBeDefined());
    expect(buttons(el).some((item) => item.textContent?.trim() === 'Deny')).toBe(false);
    button(el, 'Dismiss').click();

    await settle(fixture, () => expect(onRespondToToolApproval).toHaveBeenCalled());
    expect(onRespondToToolApproval.mock.calls[0]![0]).toMatchObject({
      approvalId: 'approval-1',
      approved: false,
    });
  });

  it("reopens the controls with the host's error when it rejects an answer", async () => {
    const onRespondToToolApproval = vi.fn(async () => {
      throw new Error('host refused');
    });
    const { el, fixture } = await mountThread([pendingApproval()], {
      adapter: { onRespondToToolApproval },
    });

    await settle(fixture, () => expect(button(el, 'Allow')).toBeDefined());
    button(el, 'Allow').click();

    await settle(fixture, () =>
      expect(
        [...el.querySelectorAll('[role="alert"]')].some((item) =>
          item.textContent?.includes('host refused'),
        ),
      ).toBe(true),
    );
    expect(button(el, 'Allow').disabled).toBe(false);
  });

  it('shows a settled approval as a receipt instead of live controls', async () => {
    const { el, fixture } = await mountThread([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'delete_file',
            args: { path: 'notes.txt' },
            result: 'deleted',
            approval: { id: 'approval-1', approved: false },
          },
        ],
      },
    ]);

    await settle(fixture, () => expect(el.textContent).toContain('Used tool: delete_file'));
    slot<HTMLButtonElement>(el, 'tool-fallback-trigger')!.click();

    await settle(fixture, () =>
      expect(slot(el, 'tool-approval-receipt')?.textContent).toContain('Denied'),
    );
    expect(buttons(el).some((item) => item.textContent?.trim() === 'Allow')).toBe(false);
  });

  it('collapses finished reasoning behind a trigger that reveals its markdown', async () => {
    const { el, fixture } = await mountThread([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'weighing **options**' },
          { type: 'text', text: 'done' },
        ],
      },
    ]);

    await settle(fixture, () => expect(slot(el, 'reasoning-trigger')).not.toBeNull());
    expect(slot(el, 'reasoning-text')).toBeNull();
    expect(slot(el, 'reasoning-trigger')!.getAttribute('aria-expanded')).toBe('false');

    slot<HTMLButtonElement>(el, 'reasoning-trigger')!.click();

    await settle(fixture, () =>
      expect(el.querySelector('[data-slot="reasoning-text"] strong')?.textContent).toBe('options'),
    );
    expect(slot(el, 'reasoning-trigger')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('locks the thread viewport while reasoning toggles', async () => {
    const { el, fixture } = await mountThread([
      { role: 'assistant', content: [{ type: 'reasoning', text: 'weighing options' }] },
    ]);
    const viewport = scrollableViewport(el);

    await settle(fixture, () => expect(slot(el, 'reasoning-trigger')).not.toBeNull());
    viewport.scrollTop = 120;
    slot<HTMLButtonElement>(el, 'reasoning-trigger')!.click();
    expect(viewport.style.scrollbarWidth).toBe('none');
    viewport.scrollTop = 80;
    viewport.dispatchEvent(new Event('scroll'));
    expect(viewport.scrollTop).toBe(120);

    await settle(fixture, () =>
      expect(slot(el, 'reasoning-trigger')!.getAttribute('data-state')).toBe('open'),
    );
    viewport.scrollTop = 160;
    slot<HTMLButtonElement>(el, 'reasoning-trigger')!.click();
    viewport.scrollTop = 80;
    viewport.dispatchEvent(new Event('scroll'));
    expect(viewport.scrollTop).toBe(160);

    fixture.destroy();
    expect(viewport.style.scrollbarWidth).toBe('');
  });

  it('holds reasoning open while it streams', async () => {
    const { el, fixture } = await mountThread(
      [{ role: 'assistant', content: [{ type: 'reasoning', text: 'still thinking' }] }],
      { isRunning: true },
    );

    await settle(fixture, () =>
      expect(slot(el, 'reasoning-text')?.textContent).toContain('still thinking'),
    );
    expect(slot(el, 'reasoning-content')?.getAttribute('aria-busy')).toBe('true');
  });

  it('locks the thread viewport when streaming reasoning collapses', async () => {
    const { el, fixture, update } = await mountThread(
      [{ role: 'assistant', content: [{ type: 'reasoning', text: 'still thinking' }] }],
      { isRunning: true },
    );
    const viewport = scrollableViewport(el);

    await settle(fixture, () => expect(slot(el, 'reasoning-text')).not.toBeNull());
    viewport.scrollTop = 120;
    update([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'still thinking' },
          { type: 'text', text: 'done' },
        ],
      },
    ]);

    await settle(fixture, () => expect(slot(el, 'reasoning-text')).toBeNull());
    expect(viewport.style.scrollbarWidth).toBe('none');
    viewport.scrollTop = 80;
    viewport.dispatchEvent(new Event('scroll'));
    expect(viewport.scrollTop).toBe(120);
  });

  it('groups consecutive reasoning before text in one disclosure', async () => {
    const { el, fixture } = await mountThread([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'first **thought**' },
          { type: 'reasoning', text: 'second *thought*' },
          { type: 'text', text: 'answer' },
        ],
      },
    ]);

    await settle(fixture, () =>
      expect(el.querySelectorAll('[data-slot="reasoning-root"]')).toHaveLength(1),
    );
    slot<HTMLButtonElement>(el, 'reasoning-trigger')!.click();

    await settle(fixture, () =>
      expect(el.querySelectorAll('[data-slot="reasoning-text"] .nxa-md')).toHaveLength(2),
    );
    const reasoning = slot(el, 'reasoning-text')!;
    expect(reasoning.textContent).toContain('first thought');
    expect(reasoning.textContent).toContain('second thought');
    expect(reasoning.querySelector('strong')?.textContent).toBe('thought');
    expect(reasoning.querySelector('em')?.textContent).toBe('thought');
    expect(el.querySelector('[data-role="assistant"]')?.textContent).toMatch(
      /first thought.*second thought.*answer/s,
    );
  });

  it('separates reasoning runs interrupted by text', async () => {
    const { el, fixture, update } = await mountThread([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'first thought' },
          { type: 'text', text: 'middle answer' },
          { type: 'reasoning', text: 'last thought' },
        ],
      },
    ]);

    await settle(fixture, () =>
      expect(el.querySelectorAll('[data-slot="reasoning-root"]')).toHaveLength(2),
    );
    el.querySelectorAll<HTMLButtonElement>('[data-slot="reasoning-trigger"]').forEach((item) =>
      item.click(),
    );

    await settle(fixture, () =>
      expect(el.querySelectorAll('[data-slot="reasoning-text"]')).toHaveLength(2),
    );
    expect(el.querySelector('[data-role="assistant"]')?.textContent).toMatch(
      /first thought.*middle answer.*last thought/s,
    );

    update([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'first thought' },
          { type: 'reasoning', text: 'continued thought' },
          { type: 'text', text: 'middle answer' },
          { type: 'reasoning', text: 'last thought' },
        ],
      },
    ]);
    await settle(fixture, () =>
      expect(el.querySelectorAll('[data-slot="reasoning-root"]')).toHaveLength(2),
    );
    await settle(fixture, () =>
      expect(el.querySelectorAll('[data-slot="reasoning-text"]')[0]?.textContent).toContain(
        'continued thought',
      ),
    );
  });

  it('streams a reasoning run when a later part is running and collapses on completion', async () => {
    const content = [
      { type: 'reasoning' as const, text: 'first thought' },
      { type: 'reasoning' as const, text: 'live thought' },
    ];
    const { el, fixture, update } = await mountThread([{ role: 'assistant', content }], {
      isRunning: true,
    });

    await settle(fixture, () =>
      expect(el.querySelectorAll('[data-slot="reasoning-root"]')).toHaveLength(1),
    );
    await settle(fixture, () =>
      expect(slot(el, 'reasoning-text')?.textContent).toContain('live thought'),
    );
    expect(slot(el, 'reasoning-content')?.getAttribute('aria-busy')).toBe('true');

    update([{ role: 'assistant', content: [...content, { type: 'text', text: 'done' }] }]);
    await settle(fixture, () => expect(slot(el, 'reasoning-text')).toBeNull());
    expect(el.querySelectorAll('[data-slot="reasoning-root"]')).toHaveLength(1);
  });
});

describe('nxa-tool-fallback labels', () => {
  it.each([
    { status: 'queued' as const, label: 'Reply queued, not sent yet' },
    { status: undefined, label: 'Waiting on tool' },
  ])('renders the $label fallback for a $status reply', async ({ status, label }) => {
    const { el, fixture } = await mountThread([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'computer_call',
            args: { kind: 'click' },
            ...(status && { responseDeliveryStatus: status }),
          },
        ],
      },
    ]);

    await settle(fixture, () =>
      expect(slot(el, 'tool-fallback-trigger')?.textContent).toContain(`${label}: computer_call`),
    );
    if (status === undefined) {
      expect(el.textContent).not.toContain('Reply queued, not sent yet');
    }
  });
});
