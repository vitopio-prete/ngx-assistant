import { Directive, booleanAttribute, computed, input } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectMessage } from '../scopes';

type FeedbackType = 'positive' | 'negative';

@Directive()
abstract class FeedbackButton {
  /** Disables the button. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly message = injectMessage();
  private readonly submitted = fromRuntime(this.message, (s) => s.metadata.submittedFeedback?.type);
  // Read lazily: `type` is set by the subclass, after this class is initialized.
  protected readonly isSubmitted = computed(() => this.submitted() === this.type);

  protected abstract readonly type: FeedbackType;

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.disabled()) return;
    this.message.submitFeedback({ type: this.type });
  }
}

const host = {
  type: 'button',
  '[disabled]': 'disabled()',
  '[attr.aria-pressed]': 'isSubmitted()',
  '[attr.data-nxa-submitted]': "isSubmitted() ? '' : null",
  '(click)': 'onClick($event)',
};

/**
 * A button that submits positive feedback for the nearest message, through the runtime's feedback
 * adapter. While the message's submitted feedback is positive it carries `aria-pressed="true"`
 * and `data-nxa-submitted`. The feedback is recorded on assistant messages even without an
 * adapter. A capture-phase `click` listener can veto it with `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaActionBarFeedbackPositive aria-label="Helpful">👍</button>
 * ```
 */
@Directive({ selector: 'button[nxaActionBarFeedbackPositive]', host })
export class NxaActionBarFeedbackPositive extends FeedbackButton {
  protected readonly type = 'positive';
}

/**
 * A button that submits negative feedback for the nearest message, through the runtime's feedback
 * adapter. While the message's submitted feedback is negative it carries `aria-pressed="true"`
 * and `data-nxa-submitted`. The feedback is recorded on assistant messages even without an
 * adapter. A capture-phase `click` listener can veto it with `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaActionBarFeedbackNegative aria-label="Not helpful">👎</button>
 * ```
 */
@Directive({ selector: 'button[nxaActionBarFeedbackNegative]', host })
export class NxaActionBarFeedbackNegative extends FeedbackButton {
  protected readonly type = 'negative';
}
