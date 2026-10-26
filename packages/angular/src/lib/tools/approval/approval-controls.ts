import { Directive, booleanAttribute, computed, input } from '@angular/core';
import type { ToolApprovalOption } from '@ngx-assistant/engine';
import { injectToolApproval } from './approval-root';

/**
 * A button that allows the pending decision, with the typed draft as a note when there is one.
 * Disabled for a request that asks a question, without a pending request, while an answer is on
 * its way, and when the thread cannot answer. A capture-phase `click` listener can veto it with
 * `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaToolApprovalApprove>Allow</button>
 * ```
 */
@Directive({
  selector: 'button[nxaToolApprovalApprove]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaToolApprovalApprove {
  /** Disables the button on top of the request state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly state = injectToolApproval();
  protected readonly isDisabled = computed(
    () => this.disabled() || this.state.locked() || this.state.isQuestion(),
  );

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    this.state.respond(true);
  }
}

/**
 * A button that denies the pending decision, with the typed draft as a note when there is one.
 * Disabled like `nxaToolApprovalApprove`. A request that asks a question is refused with
 * `nxaToolApprovalDismiss` instead, when it allows it.
 *
 * @example
 * ```html
 * <button nxaToolApprovalDeny>Deny</button>
 * ```
 */
@Directive({
  selector: 'button[nxaToolApprovalDeny]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaToolApprovalDeny {
  /** Disables the button on top of the request state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly state = injectToolApproval();
  protected readonly isDisabled = computed(
    () => this.disabled() || this.state.locked() || this.state.isQuestion(),
  );

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    this.state.respond(false);
  }
}

/**
 * A button for one option of the request. It answers with the option, or shows its confirmation
 * step when the option asks for one. An option of a custom kind is an answer, so it approves.
 * Carries `data-nxa-kind` and `data-nxa-option-id`.
 *
 * @example
 * ```html
 * @for (option of approval.state.options(); track option.id) {
 *   <button [nxaToolApprovalOption]="option">{{ option.label ?? option.id }}</button>
 * }
 * ```
 */
@Directive({
  selector: 'button[nxaToolApprovalOption]',
  host: {
    type: 'button',
    '[disabled]': 'isDisabled()',
    '[attr.data-nxa-kind]': 'option().kind',
    '[attr.data-nxa-option-id]': 'option().id',
    '(click)': 'onClick($event)',
  },
})
export class NxaToolApprovalOption {
  /** The option this button answers with. */
  readonly option = input.required<ToolApprovalOption>({ alias: 'nxaToolApprovalOption' });
  /** Disables the button on top of the request state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly state = injectToolApproval();
  protected readonly isDisabled = computed(() => this.disabled() || this.state.locked());

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    this.state.choose(this.option());
  }
}

/**
 * A button that answers with the option waiting for its confirmation. Disabled when no option
 * waits.
 *
 * @example
 * ```html
 * @if (approval.state.confirming(); as option) {
 *   <p>{{ option.description }}</p>
 *   <button nxaToolApprovalConfirm>Confirm</button>
 *   <button nxaToolApprovalConfirmCancel>Back</button>
 * }
 * ```
 */
@Directive({
  selector: 'button[nxaToolApprovalConfirm]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaToolApprovalConfirm {
  /** Disables the button on top of the request state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly state = injectToolApproval();
  protected readonly isDisabled = computed(
    () => this.disabled() || this.state.locked() || !this.state.confirming(),
  );

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    this.state.confirm();
  }
}

/** A button that leaves the confirmation step without answering. */
@Directive({
  selector: 'button[nxaToolApprovalConfirmCancel]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaToolApprovalConfirmCancel {
  /** Disables the button on top of the request state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly state = injectToolApproval();
  protected readonly isDisabled = computed(() => this.disabled() || !this.state.confirming());

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    this.state.cancelConfirm();
  }
}

/**
 * The typed answer of the request, or the note sent with a decision. Disabled when the request
 * accepts no typed answer and while the controls are locked.
 *
 * @example
 * ```html
 * <textarea nxaToolApprovalText placeholder="Add a note"></textarea>
 * ```
 */
@Directive({
  selector: 'textarea[nxaToolApprovalText]',
  host: {
    '[value]': 'state.draft()',
    '[disabled]': 'isDisabled()',
    '(input)': 'onInput($event)',
  },
})
export class NxaToolApprovalText {
  /** Disables the field on top of the request state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  protected readonly state = injectToolApproval();
  protected readonly isDisabled = computed(
    () => this.disabled() || this.state.locked() || !this.state.acceptsText(),
  );

  protected onInput(event: Event) {
    this.state.draft.set((event.target as HTMLTextAreaElement).value);
  }
}

/**
 * A button that sends the typed draft as the answer, empty included, for a question that takes a
 * typed answer (`display: "text"`, or a `select` that allows one beside its options). On a
 * decision the draft is the note of `nxaToolApprovalApprove` / `nxaToolApprovalDeny`.
 *
 * @example
 * ```html
 * <button nxaToolApprovalSubmitText>Send</button>
 * ```
 */
@Directive({
  selector: 'button[nxaToolApprovalSubmitText]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaToolApprovalSubmitText {
  /** Disables the button on top of the request state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly state = injectToolApproval();
  protected readonly isDisabled = computed(
    () => this.disabled() || this.state.locked() || !this.state.canSubmitText(),
  );

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    this.state.submitText();
  }
}

/**
 * A button that dismisses a question without an answer. Enabled only for a question that
 * declares itself `dismissible`; a decision is refused with `nxaToolApprovalDeny`.
 *
 * @example
 * ```html
 * @if (approval.state.dismissible()) {
 *   <button nxaToolApprovalDismiss>Skip</button>
 * }
 * ```
 */
@Directive({
  selector: 'button[nxaToolApprovalDismiss]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaToolApprovalDismiss {
  /** Disables the button on top of the request state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly state = injectToolApproval();
  protected readonly isDisabled = computed(
    () => this.disabled() || this.state.locked() || !this.state.dismissible(),
  );

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    this.state.dismiss();
  }
}
