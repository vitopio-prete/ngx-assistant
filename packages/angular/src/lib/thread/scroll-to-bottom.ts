import { Directive, booleanAttribute, computed, inject, input, isDevMode } from '@angular/core';
import { NXA_THREAD_VIEWPORT } from './thread-viewport';

let warnedOutsideViewport = false;

/**
 * A button that scrolls the surrounding `nxaThreadViewport` to the bottom. Disabled while the
 * viewport is already at the bottom, or when no viewport surrounds it. A capture-phase `click`
 * listener can veto the scroll with `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaScrollToBottom aria-label="Scroll to bottom">↓</button>
 * ```
 */
@Directive({
  selector: 'button[nxaScrollToBottom]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaScrollToBottom {
  /** How the viewport scrolls. */
  readonly behavior = input<ScrollBehavior>('auto');
  /** Disables the button on top of the viewport state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly viewport = inject(NXA_THREAD_VIEWPORT, { optional: true });
  protected readonly isDisabled = computed(
    () => this.disabled() || !this.viewport || this.viewport.isAtBottom(),
  );

  constructor() {
    if (isDevMode() && !this.viewport && !warnedOutsideViewport) {
      warnedOutsideViewport = true;
      console.warn(
        '[ngx-assistant] nxaScrollToBottom has no surrounding nxaThreadViewport and stays disabled. Place it inside the viewport.',
      );
    }
  }

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    this.viewport?.scrollToBottom(this.behavior());
  }
}
