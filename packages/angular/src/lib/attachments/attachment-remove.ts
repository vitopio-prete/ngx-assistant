import { Directive, booleanAttribute, computed, input } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectAttachment } from '../scopes';

/**
 * A button that removes the nearest attachment from its composer. Disabled for the attachments
 * of a message, which cannot be removed. A capture-phase `click` listener can veto the removal
 * with `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaAttachmentRemove aria-label="Remove attachment">×</button>
 * ```
 */
@Directive({
  selector: 'button[nxaAttachmentRemove]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaAttachmentRemove {
  /** Disables the button on top of the attachment state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly attachment = injectAttachment();
  private readonly fromMessage = fromRuntime(this.attachment, (s) => s.source === 'message');
  protected readonly isDisabled = computed(() => this.disabled() || this.fromMessage());

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    // A runtime may also throw before it returns a promise.
    Promise.resolve()
      .then(() => this.attachment.remove())
      .catch((error: unknown) => {
        console.error('[ngx-assistant] Removing the attachment failed', error);
      });
  }
}
