import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectMessage, injectMessageUi } from '../scopes';

/**
 * The root element of a message. It sets `data-nxa-message-id`, by which the thread viewport finds
 * the messages, and tracks whether the pointer is over it (`injectMessageUi().isHovering`),
 * including a pointer already over the element when it appears. Destroying it clears the hover.
 *
 * @example
 * ```html
 * <article *nxaMessages="let message" nxaMessageRoot>...</article>
 * ```
 */
@Directive({
  selector: '[nxaMessageRoot]',
  host: {
    '[attr.data-nxa-message-id]': 'id()',
    '(mouseenter)': 'setHovering(true)',
    '(mouseleave)': 'setHovering(false)',
  },
})
export class NxaMessageRoot {
  protected readonly id = fromRuntime(injectMessage(), (s) => s.id);
  private readonly ui = injectMessageUi();
  private active = true;

  constructor() {
    const element: HTMLElement = inject(ElementRef).nativeElement;
    afterNextRender(() => {
      if (this.active && element.matches(':hover')) this.setHovering(true);
    });
    inject(DestroyRef).onDestroy(() => {
      this.active = false;
      this.ui.isHovering.set(false);
    });
  }

  protected setHovering(value: boolean) {
    if (this.active) this.ui.isHovering.set(value);
  }
}
