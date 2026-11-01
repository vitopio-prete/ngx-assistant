import { Directive, booleanAttribute, computed, inject, input } from '@angular/core';
import { injectMessage, injectThread } from '../scopes';
import { NXA_MESSAGE_UI_EVENTS, emitMessageUiEvent } from '../ui-events';
import { reloadDisabled } from './action-state';

/**
 * A button that regenerates the nearest assistant message, as a new branch. Disabled for other
 * messages, and while the thread is running, disabled, in a voice session or does not support
 * reloads. It reports `message.reload` to `injectNxaEvent()`. A capture-phase `click` listener
 * can veto the reload with `preventDefault()`.
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

  private readonly thread = injectThread();
  private readonly message = injectMessage();
  private readonly events = inject(NXA_MESSAGE_UI_EVENTS, { optional: true });
  private readonly blocked = reloadDisabled(this.thread, this.message);
  protected readonly isDisabled = computed(() => this.disabled() || this.blocked());

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    emitMessageUiEvent(this.events, this.thread, this.message, 'message.reload');
    this.message.reload();
  }
}
