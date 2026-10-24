import { Directive, booleanAttribute, computed, input } from '@angular/core';
import { injectComposer, injectThread } from '../scopes';
import { composerSendDisabled } from './composer-state';

/**
 * A button that sends the composer. Disabled while the composer cannot send, or while a run is in
 * flight and the runtime does not queue sends. A capture-phase `click` listener can veto the send
 * with `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaComposerSend>Send</button>
 * ```
 */
@Directive({
  selector: 'button[nxaComposerSend]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaComposerSend {
  /** Disables the button on top of the composer state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly composer = injectComposer();
  private readonly sendDisabled = composerSendDisabled(injectThread(), this.composer);
  protected readonly isDisabled = computed(() => this.disabled() || this.sendDisabled());

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    this.composer.send();
  }
}
