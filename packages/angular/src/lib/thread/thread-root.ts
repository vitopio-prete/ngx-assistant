import {
  DOCUMENT,
  DestroyRef,
  Directive,
  ElementRef,
  afterNextRender,
  inject,
} from '@angular/core';
import { injectThread } from '../scopes';
import { THREAD_ROOT_ATTRIBUTE, isCompositionKey } from '../composer/composer-state';

// The thread root an Escape started in. Marked by the root itself, so a root inside a closed
// shadow root, which the document's composed path does not reveal, still claims it.
const escapeThreadRoots = new WeakMap<KeyboardEvent, Element>();

/**
 * The root element of a thread. It marks the thread for the composer focus rules: a run start or
 * a cancelled edit moves the focus only to a composer of the same thread root.
 *
 * While it is mounted, an Escape not handled by anything else stops the thread's speech, even
 * after the control that started it is gone. An Escape inside another thread root is left to that
 * thread; one outside every thread root goes to the first speaking thread. Escapes that end an IME
 * composition are ignored.
 *
 * @example
 * ```html
 * <section nxaThreadRoot>
 *   <div nxaThreadViewport>...</div>
 * </section>
 * ```
 */
@Directive({
  selector: '[nxaThreadRoot]',
  // The attribute is THREAD_ROOT_ATTRIBUTE; host keys must be literals.
  host: { 'data-nxa-thread-root': '', '(keydown)': 'onKeydown($event)' },
})
export class NxaThreadRoot {
  private readonly element: HTMLElement = inject(ElementRef).nativeElement;
  private readonly thread = injectThread();

  constructor() {
    const doc = inject(DOCUMENT);
    // Bubble phase, so capture-phase Escape handlers consume the event first.
    const onDocumentKeydown = (event: KeyboardEvent) => this.stopSpeechOnEscape(event);
    afterNextRender(() => doc.addEventListener('keydown', onDocumentKeydown));
    inject(DestroyRef).onDestroy(() => doc.removeEventListener('keydown', onDocumentKeydown));
  }

  protected onKeydown(event: KeyboardEvent) {
    // The innermost root claims it: it runs first while the event bubbles.
    if (event.key === 'Escape' && !escapeThreadRoots.has(event)) {
      escapeThreadRoots.set(event, this.element);
    }
  }

  private stopSpeechOnEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || isCompositionKey(event) || event.defaultPrevented) return;
    const root =
      escapeThreadRoots.get(event) ??
      event
        .composedPath()
        .find(
          (target): target is Element =>
            (target as Element).hasAttribute?.(THREAD_ROOT_ATTRIBUTE) === true,
        );
    if (root && root !== this.element) return;
    if (this.thread.getState().speech === undefined) return;
    event.preventDefault();
    try {
      this.thread.stopSpeaking();
    } catch (error) {
      // The speech can end between the state read and this call.
      if (!(error instanceof Error) || error.message !== 'No message is being spoken') throw error;
    }
  }
}
