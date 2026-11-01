import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import {
  NxaToolApprovalApprove,
  NxaToolApprovalConfirm,
  NxaToolApprovalConfirmCancel,
  NxaToolApprovalDeny,
  NxaToolApprovalOption,
  NxaToolApprovalRoot,
  injectToolCall,
} from '@ngx-assistant/angular';
import type { ToolApprovalOption } from '@ngx-assistant/engine';
import { NxaIcon } from '../icons';

/** A labelled value shown in the card. */
export interface ApprovalCardDetail {
  readonly label: string;
  readonly value: string;
}

/** Where the request of the card stands. */
export type ApprovalCardState = 'request' | 'running' | 'done' | 'denied';

const RECEIPT_TEXT: Record<Exclude<ApprovalCardState, 'request'>, string> = {
  running: 'Approved, running',
  done: 'Finished',
  denied: 'Denied',
};

let nextId = 0;

const BUTTON =
  'flex h-8 items-center rounded-full px-3.5 text-xs font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:pointer-events-none disabled:opacity-50';
const GHOST = `${BUTTON} text-nxa-foreground hover:bg-nxa-accent`;
const PRIMARY = `${BUTTON} bg-nxa-primary text-nxa-primary-foreground hover:opacity-90`;
const DESTRUCTIVE = `${BUTTON} bg-nxa-destructive text-white hover:opacity-90`;

/**
 * A card that asks the user to allow what a tool is about to do, for a tool UI registered with
 * `provideToolUi`: a title and subtitle, an optional summary, the command and details of the
 * action, and Deny / Allow buttons (Always allow too when the request offers it, and every option
 * the request declares). Once answered it turns into a receipt: "Approved, running", "Finished"
 * or "Denied", announced to screen readers. While an answer is on its way the status says so and
 * holds the focus of the answer, which comes back if the answer is refused.
 *
 * It answers the approval request of the tool call it is in, with the `nxaToolApproval*`
 * primitives. Escape never denies: a request is answered only by its buttons.
 *
 * @example
 * ```ts
 * @Component({
 *   imports: [NxaApprovalCard],
 *   template: `<nxa-approval-card title="Delete the file" subtitle="Needs your approval"
 *     [command]="'rm ' + call.args().path" variant="destructive" />`,
 * })
 * class DeleteFileUi { protected readonly call = injectToolCall<{ path: string }>(); }
 *
 * provideToolUi({ toolName: 'delete_file', component: DeleteFileUi })
 * ```
 */
@Component({
  selector: 'nxa-approval-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaToolApprovalApprove,
    NxaToolApprovalDeny,
    NxaToolApprovalOption,
    NxaToolApprovalConfirm,
    NxaToolApprovalConfirmCancel,
    NxaIcon,
  ],
  hostDirectives: [NxaToolApprovalRoot],
  host: {
    role: 'group',
    'data-slot': 'approval-card',
    '[attr.data-variant]': 'variant()',
    '[attr.aria-labelledby]': 'titleId',
    '[attr.aria-describedby]': 'description() ? descriptionId : null',
    '(focusin)': 'onFocusIn($event)',
    '(focusout)': 'onFocusOut($event)',
    class:
      'my-1 flex w-full max-w-sm flex-col gap-3.5 rounded-2xl border border-nxa-border bg-nxa-background p-4 text-nxa-foreground',
  },
  template: `
    <div class="flex items-center gap-3">
      <span
        aria-hidden="true"
        class="flex size-9 shrink-0 items-center justify-center rounded-xl"
        [class]="
          variant() === 'destructive'
            ? 'bg-nxa-destructive/10 text-nxa-destructive'
            : 'bg-nxa-muted text-nxa-muted-foreground'
        "
      >
        <nxa-icon
          [name]="variant() === 'destructive' ? 'circle-alert' : 'sparkle'"
          class="size-4"
        />
      </span>
      <div class="flex min-w-0 flex-col">
        <p [id]="titleId" class="text-sm font-medium">{{ title() }}</p>
        @if (subtitle()) {
          <p class="text-xs text-nxa-muted-foreground">{{ subtitle() }}</p>
        }
      </div>
    </div>

    @if (description()) {
      <p [id]="descriptionId" class="text-[13px] text-nxa-muted-foreground">{{ description() }}</p>
    }

    @if (command()) {
      <div
        data-slot="approval-card-command"
        class="rounded-xl bg-nxa-muted px-3.5 py-2.5 font-mono text-xs break-all"
      >
        {{ command() }}
      </div>
    }

    @if (details().length) {
      <dl class="flex flex-col gap-2 rounded-xl bg-nxa-muted px-3.5 py-2.5">
        @for (detail of details(); track $index) {
          <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 text-xs">
            <dt class="font-mono text-nxa-muted-foreground">{{ detail.label }}</dt>
            <dd class="break-words">{{ detail.value }}</dd>
          </div>
        }
      </dl>
    }

    @if (approval.state.error(); as error) {
      <p role="alert" class="text-xs text-nxa-destructive">{{ error }}</p>
    }

    <div class="flex min-h-8 flex-wrap items-center justify-end gap-2">
      @if (state() === 'request') {
        @if (approval.state.confirming(); as option) {
          <span class="me-auto text-xs text-nxa-muted-foreground">
            {{ confirmText(option) }}
          </span>
          <button nxaToolApprovalConfirmCancel data-slot="approval-card-back" [class]="ghost">
            Back
          </button>
          <button nxaToolApprovalConfirm data-slot="approval-card-confirm" [class]="primary">
            Confirm
          </button>
        } @else if (approval.state.options().length) {
          @for (option of approval.state.options(); track option.id) {
            <button
              [nxaToolApprovalOption]="option"
              data-slot="approval-card-option"
              [class]="optionClass(option)"
            >
              {{ optionLabel(option) }}
            </button>
          }
        } @else {
          <button nxaToolApprovalDeny data-slot="approval-card-deny" [class]="ghost">
            {{ denyLabel() }}
          </button>
          <button nxaToolApprovalApprove data-slot="approval-card-allow" [class]="primaryClass()">
            {{ allowLabel() }}
          </button>
        }
      }
      <!-- An empty live region from the start, so the receipt that fills it is announced. -->
      <div
        #receipt
        tabindex="-1"
        role="status"
        data-slot="approval-card-receipt"
        class="flex items-center gap-2 text-xs text-nxa-muted-foreground outline-none"
      >
        @if (state() === 'request') {
          @if (approval.state.submitting()) {
            <nxa-icon name="loader" class="size-3.5 animate-spin motion-reduce:animate-none" />
            Sending the answer
          }
        } @else {
          @switch (state()) {
            @case ('running') {
              <nxa-icon name="loader" class="size-3.5 animate-spin motion-reduce:animate-none" />
            }
            @case ('denied') {
              <nxa-icon name="x" class="size-3.5" />
            }
            @default {
              <nxa-icon name="check" class="size-3.5" />
            }
          }
          {{ receiptText() }}
        }
      </div>
    </div>
  `,
})
export class NxaApprovalCard {
  /** What the tool is about to do; the name of the card. */
  readonly title = input.required<string>();
  /** A line under the title. */
  readonly subtitle = input<string | undefined>(undefined);
  /** A summary that describes the card. */
  readonly description = input<string | undefined>(undefined);
  /** The command to run, shown in monospace. */
  readonly command = input<string | undefined>(undefined);
  /** Labelled values, as a definition list. */
  readonly details = input<readonly ApprovalCardDetail[]>([]);
  /** `destructive` marks an action that destroys something. */
  readonly variant = input<'default' | 'destructive'>('default');
  /** The label of the button that allows once. */
  readonly allowLabel = input('Allow once');
  /** The label of the option that always allows, when the request offers it. */
  readonly alwaysAllowLabel = input('Always allow');
  /** The label of the button that denies. */
  readonly denyLabel = input('Deny');
  /** Replaces the text of the receipt. */
  readonly statusLabel = input<string | undefined>(undefined);

  protected readonly approval = inject(NxaToolApprovalRoot, { self: true });
  private readonly call = injectToolCall();
  protected readonly titleId = `nxa-approval-card-title-${nextId}`;
  protected readonly descriptionId = `nxa-approval-card-description-${nextId++}`;
  protected readonly ghost = GHOST;
  protected readonly primary = PRIMARY;

  /** Where the request stands, from the approval and the status of the call. */
  readonly state = computed((): ApprovalCardState => {
    const receipt = this.approval.state.receipt();
    if (!receipt) return 'request';
    if (receipt.outcome !== 'allowed') return 'denied';
    return this.call.status().type === 'running' ? 'running' : 'done';
  });
  protected readonly receiptText = computed(() => {
    const state = this.state();
    return state === 'request' ? '' : (this.statusLabel() ?? RECEIPT_TEXT[state]);
  });
  protected readonly primaryClass = computed(() =>
    this.variant() === 'destructive' ? DESTRUCTIVE : PRIMARY,
  );

  private readonly receipt = viewChild<ElementRef<HTMLElement>>('receipt');
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  /** The control inside the card that has the focus, while it has it. */
  private focused: HTMLElement | null = null;

  constructor() {
    const injector = inject(Injector);
    const document = inject(DOCUMENT);
    const receipt = () => this.receipt()?.nativeElement;

    // An answer on its way disables the buttons: the focus waits on the status, which says so,
    // instead of leaving the card. A refused answer gives it back to the button.
    let answered: HTMLElement | null = null;
    effect(() => {
      const submitting = this.approval.state.submitting();
      afterNextRender(
        () => {
          const active = document.activeElement as HTMLElement | null;
          if (submitting) {
            if (active && this.host.contains(active) && active.matches(':disabled')) {
              answered = active;
              receipt()?.focus({ preventScroll: true });
            }
            return;
          }
          const button = answered;
          answered = null;
          if (button?.isConnected && !button.matches(':disabled') && active === receipt()) {
            button.focus({ preventScroll: true });
          }
        },
        { injector },
      );
    });

    // The focused answer goes away with the request: the receipt takes the focus.
    effect(() => {
      if (this.state() === 'request') return;
      afterNextRender(
        () => {
          const focused = this.focused;
          if (!focused || focused.isConnected) return;
          this.focused = null;
          if (focused.ownerDocument.activeElement === focused.ownerDocument.body) {
            receipt()?.focus({ preventScroll: true });
          }
        },
        { injector },
      );
    });
  }

  protected optionLabel(option: ToolApprovalOption) {
    if (option.label) return option.label;
    if (option.kind === 'allow-once') return this.allowLabel();
    if (option.kind === 'allow-always') return this.alwaysAllowLabel();
    if (option.kind === 'reject-once' || option.kind === 'reject-always') return this.denyLabel();
    return option.id;
  }

  protected confirmText(option: ToolApprovalOption) {
    const confirm = typeof option.confirm === 'object' ? option.confirm : undefined;
    return confirm?.description ?? confirm?.title ?? option.description ?? 'Are you sure?';
  }

  protected optionClass(option: ToolApprovalOption) {
    return option.kind === 'allow-once' ? this.primaryClass() : GHOST;
  }

  protected onFocusIn(event: FocusEvent) {
    this.focused = event.target as HTMLElement;
  }

  protected onFocusOut(event: FocusEvent) {
    const target = event.target as HTMLElement;
    const host = event.currentTarget as HTMLElement;
    const next = (event.relatedTarget as Node | null) ?? host.ownerDocument.activeElement;
    // Leaving the card for another control forgets it; a control that disappears does not.
    if (target.isConnected && !host.contains(next)) this.focused = null;
  }
}
