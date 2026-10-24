import { Directive, ElementRef, inject } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectComposer, injectThread } from '../scopes';
import { COMPOSER_INPUT_SELECTOR, COMPOSER_SELECTOR, composerSendDisabled } from './composer-state';

// Keeps tabindex="-1": roving-tabindex widgets click-focus items at -1.
const INTERACTIVE_ELEMENT_SELECTOR = [
  'a',
  'audio[controls]',
  'button',
  'details',
  'embed',
  'iframe',
  'input',
  'label',
  'select',
  'summary',
  'textarea',
  'video[controls]',
  "[contenteditable]:not([contenteditable='false'])",
  '[tabindex]',
].join(', ');

/**
 * The root of a composer, usually a `<form>`: submitting it sends the composer, and a primary
 * mousedown on blank space moves the focus to the composer input.
 *
 * The root always prevents the native submit, so it works next to Angular forms (`NgForm`,
 * `[formGroup]`) on the same form. A capture-phase `mousedown` listener can veto the focus move
 * with `preventDefault()`, and a descendant that needs the native mousedown can stop its
 * propagation. The element carries `data-nxa-composer-type` (`thread` or `edit`).
 *
 * @example
 * ```html
 * <form nxaComposerRoot>
 *   <textarea nxaComposerInput aria-label="Message"></textarea>
 *   <button nxaComposerSend>Send</button>
 * </form>
 * ```
 */
@Directive({
  selector: '[nxaComposerRoot]',
  host: {
    '[attr.data-nxa-composer-type]': 'type()',
    '(submit)': 'onSubmit($event)',
    '(mousedown)': 'onMousedown($event)',
  },
})
export class NxaComposerRoot {
  private readonly composer = injectComposer();
  private readonly sendDisabled = composerSendDisabled(injectThread(), this.composer);
  protected readonly type = fromRuntime(this.composer, (s) => s.type);
  private readonly element: HTMLElement = inject(ElementRef).nativeElement;

  protected onSubmit(event: Event) {
    // Only this root's own form: a submit can bubble from a form nested in a non-form root.
    if (event.target !== this.element) return;
    // Angular forms on the same element prevent the default too, so this is not a veto.
    event.preventDefault();
    if (this.sendDisabled()) return;
    this.composer.send();
  }

  protected onMousedown(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target as Node | null;
    // nodeType rather than instanceof: the element may come from another window.
    if (target?.nodeType !== 1 || !this.element.contains(target)) return;
    // Bounded to the root: a wrapper above it may carry tabindex="-1".
    const interactive = (target as Element).closest(INTERACTIVE_ELEMENT_SELECTOR);
    if (interactive && this.element.contains(interactive)) return;
    const input = Array.from(
      this.element.querySelectorAll<HTMLElement>(COMPOSER_INPUT_SELECTOR),
    ).find((candidate) => candidate.closest(COMPOSER_SELECTOR) === this.element);
    if (!input) return;
    event.preventDefault();
    input.focus();
  }
}
