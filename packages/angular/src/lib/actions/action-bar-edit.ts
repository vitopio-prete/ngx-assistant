import { Directive, booleanAttribute, computed, input } from '@angular/core';
import { injectMessage, injectThread } from '../scopes';
import { editDisabled } from './action-state';

/**
 * A button that starts editing the nearest message through its edit composer. Disabled while the
 * message is being edited, or while the thread is disabled, runs a voice session or does not
 * support edits. A capture-phase `click` listener can veto the edit with `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaActionBarEdit>Edit</button>
 * ```
 */
@Directive({
  selector: 'button[nxaActionBarEdit]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaActionBarEdit {
  /** Disables the button on top of the message state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly message = injectMessage();
  private readonly blocked = editDisabled(injectThread(), this.message);
  protected readonly isDisabled = computed(() => this.disabled() || this.blocked());

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    this.message.composer.beginEdit();
  }
}
