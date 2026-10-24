import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';
import { NXA_THREAD_VIEWPORT } from './thread-viewport';

/**
 * A footer inside `nxaThreadViewport`, typically sticky at its bottom, whose height (top margin
 * included) covers the end of the content. The viewport counts positions within that height of the
 * bottom as at the bottom, and a pinned viewport follows when the footer grows. Several footers
 * sum. Outside a viewport it does nothing.
 *
 * @example
 * ```html
 * <div nxaThreadViewportFooter class="sticky bottom-0">
 *   <form nxaComposerRoot>...</form>
 * </div>
 * ```
 */
@Directive({ selector: '[nxaThreadViewportFooter]' })
export class NxaThreadViewportFooter {
  constructor() {
    const viewport = inject(NXA_THREAD_VIEWPORT, { optional: true });
    const element: HTMLElement = inject(ElementRef).nativeElement;
    if (!viewport) return;

    let dispose: (() => void) | undefined;
    afterNextRender(() => {
      const inset = viewport.registerContentInset();
      const updateHeight = () => {
        const marginTop = Number.parseFloat(getComputedStyle(element).marginTop) || 0;
        inset.setHeight(element.offsetHeight + marginTop);
      };
      updateHeight();
      const observer =
        typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateHeight) : undefined;
      observer?.observe(element);
      dispose = () => {
        observer?.disconnect();
        inset.unregister();
      };
    });
    inject(DestroyRef).onDestroy(() => dispose?.());
  }
}
