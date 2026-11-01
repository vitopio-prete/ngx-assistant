import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { injectToolCall, provideToolUi } from '@ngx-assistant/angular';
import type { ThreadMessageLike, ToolCallMessagePart } from '@ngx-assistant/engine';
import { axeViolations } from '../../testing/a11y';
import { mountThread, settle, slot, stubResizeObserver } from '../../testing/thread-harness';
import { keydown } from '../../testing/thread-list-harness';
import { type ApprovalCardDetail, NxaApprovalCard } from './approval-card';

/** What the registered tool UI passes to the card; set before mounting. */
const props = signal<{
  description?: string;
  command?: string;
  details?: ApprovalCardDetail[];
  variant?: 'default' | 'destructive';
  allowLabel?: string;
  alwaysAllowLabel?: string;
  denyLabel?: string;
  statusLabel?: string;
}>({});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaApprovalCard],
  template: `
    @let p = props();
    <nxa-approval-card
      title="Publish the release"
      subtitle="Needs your approval"
      [description]="p.description"
      [command]="p.command"
      [details]="p.details ?? []"
      [variant]="p.variant ?? 'default'"
      [allowLabel]="p.allowLabel ?? 'Allow once'"
      [alwaysAllowLabel]="p.alwaysAllowLabel ?? 'Always allow'"
      [denyLabel]="p.denyLabel ?? 'Deny'"
      [statusLabel]="p.statusLabel"
    />
  `,
})
class PublishUi {
  protected readonly props = props;
  protected readonly call = injectToolCall();
}

const publish = (
  approval: NonNullable<ToolCallMessagePart['approval']> | undefined,
  extra: Partial<ToolCallMessagePart> = {},
): ThreadMessageLike => ({
  role: 'assistant',
  content: [
    {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'publish',
      args: {},
      ...(approval && { approval }),
      ...extra,
    },
  ],
});

const pending = (options?: NonNullable<ToolCallMessagePart['approval']>['options']) =>
  publish({ id: 'approval-1', ...(options && { options }) });

const mountCard = (
  messages: readonly ThreadMessageLike[],
  onRespondToToolApproval = vi.fn(),
  isRunning?: boolean,
) =>
  mountThread(messages, {
    adapter: { onRespondToToolApproval },
    providers: [provideToolUi({ toolName: 'publish', component: PublishUi })],
    ...(isRunning !== undefined && { isRunning }),
  });

const card = (el: HTMLElement) => slot(el, 'approval-card')!;
const buttonNamed = (el: HTMLElement, name: string) =>
  [...card(el).querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === name,
  )!;

beforeAll(stubResizeObserver);

afterEach(() => {
  props.set({});
  document.body.replaceChildren();
});

describe('nxa-approval-card', () => {
  it('focuses the receipt after the focused answer settles', async () => {
    const respond = vi.fn();
    const { el, fixture, update } = await mountCard([pending()], respond);
    await settle(fixture, () => expect(card(el)).toBeTruthy());

    const answer = buttonNamed(el, 'Allow once');
    answer.focus();
    answer.click();
    await settle(fixture, () => expect(respond).toHaveBeenCalled());
    expect(respond.mock.calls[0]![0]).toMatchObject({ approvalId: 'approval-1', approved: true });

    update([publish({ id: 'approval-1', approved: true })]);
    await settle(fixture, () =>
      expect(document.activeElement).toBe(slot(el, 'approval-card-receipt')),
    );
    expect(slot(el, 'approval-card-receipt')!.getAttribute('role')).toBe('status');
    expect(slot(el, 'approval-card-receipt')!.textContent).toContain('Finished');
  });

  it('holds the focus on the status while the answer is on its way, and gives it back when refused', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let reject!: (error: Error) => void;
    const respond = vi.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const { el, fixture } = await mountCard([pending()], respond);
    await settle(fixture, () => expect(card(el)).toBeTruthy());

    const answer = buttonNamed(el, 'Allow once');
    answer.focus();
    answer.click();
    await settle(fixture, () =>
      expect(document.activeElement).toBe(slot(el, 'approval-card-receipt')),
    );
    expect(slot(el, 'approval-card-receipt')!.textContent).toContain('Sending the answer');
    expect(answer.disabled).toBe(true);

    reject(new Error('Not allowed now'));
    await settle(fixture, () => expect(document.activeElement).toBe(answer));
    expect(answer.disabled).toBe(false);
    expect(slot(el, 'approval-card-receipt')!.textContent?.trim()).toBe('');
  });

  it('uses custom action labels and answers with the declared options', async () => {
    props.set({
      allowLabel: 'Publish now',
      alwaysAllowLabel: 'Always publish',
      denyLabel: 'Keep as draft',
    });
    const respond = vi.fn();
    const { el, fixture } = await mountCard(
      [
        pending([
          { id: 'never', kind: 'reject-once' },
          { id: 'always', kind: 'allow-always' },
          { id: 'once', kind: 'allow-once' },
        ]),
      ],
      respond,
    );
    await settle(fixture, () => expect(card(el)).toBeTruthy());

    expect(
      [...card(el).querySelectorAll('button')].map((button) => button.textContent?.trim()),
    ).toEqual(['Always publish', 'Publish now', 'Keep as draft']);
    buttonNamed(el, 'Always publish').click();
    await settle(fixture, () => expect(respond).toHaveBeenCalled());
    expect(respond.mock.calls[0]![0]).toMatchObject({ approved: true, optionId: 'always' });
  });

  it('labels Allow and Deny without declared options, and denies with Deny', async () => {
    props.set({ allowLabel: 'Publish now', denyLabel: 'Keep as draft' });
    const respond = vi.fn();
    const { el, fixture } = await mountCard([pending()], respond);
    await settle(fixture, () => expect(card(el)).toBeTruthy());

    buttonNamed(el, 'Keep as draft').click();
    await settle(fixture, () => expect(respond).toHaveBeenCalled());
    expect(respond.mock.calls[0]![0]).toMatchObject({ approved: false });
    expect(buttonNamed(el, 'Publish now')).toBeTruthy();
  });

  it('omits the command field when no command is supplied', async () => {
    const { el, fixture } = await mountCard([pending()]);
    await settle(fixture, () => expect(card(el)).toBeTruthy());
    expect(slot(el, 'approval-card-command')).toBeNull();

    props.set({ command: 'npm publish --tag latest' });
    await settle(fixture, () =>
      expect(slot(el, 'approval-card-command')?.textContent?.trim()).toBe(
        'npm publish --tag latest',
      ),
    );
  });

  it('renders details as definition pairs', async () => {
    props.set({
      details: [
        { label: 'Records', value: '12 selected' },
        { label: 'Scope', value: 'Archived conversations' },
      ],
    });
    const { el, fixture } = await mountCard([pending()]);
    await settle(fixture, () => expect(card(el)).toBeTruthy());

    expect([...card(el).querySelectorAll('dt')].map((node) => node.textContent)).toEqual([
      'Records',
      'Scope',
    ]);
    expect([...card(el).querySelectorAll('dd')].map((node) => node.textContent)).toEqual([
      '12 selected',
      'Archived conversations',
    ]);
  });

  it('marks destructive actions with its variant', async () => {
    props.set({ variant: 'destructive' });
    const { el, fixture } = await mountCard([pending()]);
    await settle(fixture, () => expect(card(el)).toBeTruthy());
    expect(card(el).getAttribute('role')).toBe('group');
    expect(card(el).getAttribute('data-variant')).toBe('destructive');
  });

  it('never denies on Escape, even with a request open', async () => {
    const respond = vi.fn();
    const { el, fixture } = await mountCard([pending()], respond);
    await settle(fixture, () => expect(card(el)).toBeTruthy());

    buttonNamed(el, 'Deny').focus();
    keydown(buttonNamed(el, 'Deny'), 'Escape');
    keydown(card(el), 'Escape');
    await fixture.whenStable();
    expect(respond).not.toHaveBeenCalled();
  });

  it('keeps an empty live region while the request is open, so the receipt is announced', async () => {
    const { el, fixture, update } = await mountCard([pending()]);
    await settle(fixture, () => expect(card(el)).toBeTruthy());
    const region = slot(el, 'approval-card-receipt')!;
    expect(region.getAttribute('role')).toBe('status');
    expect(region.textContent?.trim()).toBe('');

    update([publish({ id: 'approval-1', approved: false })]);
    await settle(fixture, () => expect(region.textContent).toContain('Denied'));
    expect(slot(el, 'approval-card-receipt')).toBe(region);
  });

  it('announces the receipt text and allows it to be overridden', async () => {
    const { el, fixture, update } = await mountCard([
      publish({ id: 'approval-1', approved: true }),
    ]);
    await settle(fixture, () =>
      expect(slot(el, 'approval-card-receipt')?.textContent).toContain('Finished'),
    );

    update([publish({ id: 'approval-1', approved: true })], { isRunning: true });
    await settle(fixture, () =>
      expect(slot(el, 'approval-card-receipt')?.textContent).toContain('Approved, running'),
    );

    props.set({ statusLabel: 'Deletion was declined' });
    update([publish({ id: 'approval-1', approved: false })]);
    await settle(fixture, () =>
      expect(slot(el, 'approval-card-receipt')?.textContent).toContain('Deletion was declined'),
    );
  });

  it('labels the group with its title and describes it with the summary', async () => {
    props.set({ description: 'This publishes the current release to every production region.' });
    const { el, fixture } = await mountCard([pending()]);
    await settle(fixture, () => expect(card(el)).toBeTruthy());

    const group = card(el);
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent).toBe(
      'Publish the release',
    );
    expect(document.getElementById(group.getAttribute('aria-describedby')!)!.textContent).toBe(
      'This publishes the current release to every production region.',
    );
  });

  it('has no axe violations as a request and as a receipt', async () => {
    props.set({
      description: 'Publishes to production.',
      command: 'npm publish',
      details: [{ label: 'Tag', value: 'latest' }],
    });
    const { el, fixture, update } = await mountCard([pending()]);
    await settle(fixture, () => expect(card(el)).toBeTruthy());
    expect(await axeViolations(card(el))).toEqual([]);

    update([publish({ id: 'approval-1', approved: false })]);
    await settle(fixture, () =>
      expect(slot(el, 'approval-card-receipt')?.textContent).toContain('Denied'),
    );
    expect(await axeViolations(card(el))).toEqual([]);
  });
});
