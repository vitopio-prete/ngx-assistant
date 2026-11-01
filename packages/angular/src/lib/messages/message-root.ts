import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectMessage, injectMessageUi } from '../scopes';

// A focus the browser would not mark (a click on a button) does not count: the hover covers it.
const isFocusVisible = (element: Element) => {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
};

/**
 * The root element of a message. It sets `data-nxa-message-id`, by which the thread viewport finds
 * the messages, and tracks whether the pointer is over it (`injectMessageUi().isHovering`),
 * including a pointer already over the element when it appears, and whether the keyboard focus is
 * inside it (`injectMessageUi().isFocusWithin`, also as `data-nxa-focus-within`), so that what the
 * hover reveals is reachable from the keyboard too. The keyboard focus is a focus the browser marks
 * as `:focus-visible`: a click on a button inside the message does not keep it shown once the
 * pointer leaves. Destroying it clears both.
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
    '[attr.data-nxa-focus-within]': "ui.isFocusWithin() ? '' : null",
    '(mouseenter)': 'setHovering(true)',
    '(mouseleave)': 'onMouseLeave()',
    '(focusin)': 'onFocusIn($event)',
    '(focusout)': 'onFocusOut($event)',
  },
})
export class NxaMessageRoot {
  protected readonly id = fromRuntime(injectMessage(), (s) => s.id);
  protected readonly ui = injectMessageUi();
  private readonly element: HTMLElement = inject(ElementRef).nativeElement;
  private active = true;
  private stopWatchingFocus: (() => void) | null = null;

  constructor() {
    afterNextRender(() => {
      if (!this.active) return;
      if (this.element.matches(':hover')) this.setHovering(true);
      const focused = this.element.ownerDocument.activeElement;
      if (focused && this.element.contains(focused) && isFocusVisible(focused)) {
        this.setFocusWithin(true);
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.active = false;
      this.stopWatchingFocus?.();
      this.ui.isHovering.set(false);
      this.ui.isFocusWithin.set(false);
    });
  }

  protected setHovering(value: boolean) {
    if (this.active) this.ui.isHovering.set(value);
  }

  protected onMouseLeave() {
    this.setHovering(false);
    // A focused element removed from the message took the focus with it, without an event.
    if (
      this.ui.isFocusWithin() &&
      !this.element.contains(this.element.ownerDocument.activeElement)
    ) {
      this.setFocusWithin(false);
    }
  }

  protected setFocusWithin(value: boolean) {
    if (!this.active) return;
    this.ui.isFocusWithin.set(value);
    if (value) this.watchFocus();
    else {
      this.stopWatchingFocus?.();
      this.stopWatchingFocus = null;
    }
  }

  // Removing the focused element moves the focus out without a `focusout` on the way: the next
  // focus elsewhere in the document tells that the focus left.
  private watchFocus() {
    if (this.stopWatchingFocus) return;
    const document = this.element.ownerDocument;
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && this.element.contains(event.target)) return;
      this.setFocusWithin(false);
    };
    document.addEventListener('focusin', onFocusIn, true);
    this.stopWatchingFocus = () => document.removeEventListener('focusin', onFocusIn, true);
  }

  protected onFocusIn(event: FocusEvent) {
    if (event.target instanceof Element && isFocusVisible(event.target)) this.setFocusWithin(true);
  }

  protected onFocusOut(event: FocusEvent) {
    // A move between two elements of the message keeps the focus inside it.
    const next = event.relatedTarget;
    if (next instanceof Node && this.element.contains(next)) return;
    this.setFocusWithin(false);
  }
}
