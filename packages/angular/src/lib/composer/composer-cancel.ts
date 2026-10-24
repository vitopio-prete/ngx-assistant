import { Directive, ElementRef, booleanAttribute, computed, inject, input } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectComposer } from '../scopes';
import { cancelWithFocus } from './composer-state';

/**
 * A button that cancels the composer: it stops the run of a thread composer and ends the edit of
 * an edit composer. Disabled while there is nothing to cancel. A capture-phase `click` listener
 * can veto the cancel with `preventDefault()`.
 *
 * Ending an edit from the keyboard or assistive technology moves the focus to the thread composer
 * of the same `data-nxa-thread-root`, unless a handler moved it elsewhere; a pointer click leaves
 * the focus alone.
 *
 * @example
 * ```html
 * <button nxaComposerCancel>Stop</button>
 * ```
 */
@Directive({
  selector: 'button[nxaComposerCancel]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaComposerCancel {
  /** Disables the button on top of the composer state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly element: HTMLButtonElement = inject(ElementRef).nativeElement;
  private readonly composer = injectComposer();
  private readonly canCancel = fromRuntime(this.composer, (s) => s.canCancel);
  protected readonly isDisabled = computed(() => this.disabled() || !this.canCancel());

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    // `detail` is 0 for a click synthesized by the keyboard or assistive technology.
    cancelWithFocus(this.composer, event.detail === 0 ? this.element : null);
  }
}
