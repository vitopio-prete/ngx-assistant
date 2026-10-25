import { Directive, booleanAttribute, computed, input } from '@angular/core';
import { injectMessage, injectThread } from '../scopes';
import { reloadDisabled } from './action-state';

/**
 * A button that regenerates the nearest assistant message, as a new branch. Disabled for other
 * messages, and while the thread is running, disabled, in a voice session or does not support
 * reloads. A capture-phase `click` listener can veto the reload with `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaActionBarReload>Regenerate</button>
 * ```
 */
@Directive({
  selector: 'button[nxaActionBarReload]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaActionBarReload {
  /** Disables the button on top of the message state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly message = injectMessage();
  private readonly blocked = reloadDisabled(injectThread(), this.message);
  protected readonly isDisabled = computed(() => this.disabled() || this.blocked());

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    this.message.reload();
  }
}
