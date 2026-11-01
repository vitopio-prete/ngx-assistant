import { DestroyRef, ElementRef, inject } from '@angular/core';

/** The element a scroll lock starts from: an element, its `ElementRef`, or a function giving one. */
export type NxaScrollLockTarget =
  HTMLElement | ElementRef<HTMLElement> | (() => HTMLElement | null | undefined);

const resolve = (target: NxaScrollLockTarget) =>
  typeof target === 'function'
    ? target()
    : target instanceof ElementRef
      ? target.nativeElement
      : target;

const findScrollableAncestor = (element: HTMLElement | null | undefined) => {
  let current = element ?? null;
  while (current) {
    const { overflowY } = getComputedStyle(current);
    if (overflowY === 'scroll' || overflowY === 'auto') return current;
    current = current.parentElement;
  }
  return null;
};

/**
 * Creates a lock of the scroll position, for an element whose height animates (a collapsible
 * opening or closing): calling it keeps the nearest scrollable ancestor of `target` where it is for
 * `durationMs`, and hides its scrollbar meanwhile, padding the side the scrollbar took (the left
 * one in RTL) so that the content does not shift. A new call ends the previous lock first; the
 * returned `dispose` ends the current one. The target is resolved on every call, so a moved element
 * locks its current container.
 */
export function createScrollLock(
  target: NxaScrollLockTarget,
  durationMs: number | (() => number),
): { lock: () => void; dispose: () => void } {
  let cleanup: (() => void) | null = null;

  const lock = () => {
    cleanup?.();

    const container = findScrollableAncestor(resolve(target));
    if (!container) {
      cleanup = null;
      return;
    }

    const scrollPosition = container.scrollTop;
    const scrollbarWidth = container.style.scrollbarWidth;
    const computed = getComputedStyle(container);
    const paddingSide = computed.direction === 'rtl' ? 'paddingLeft' : 'paddingRight';
    const previousPadding = container.style[paddingSide];
    const elementScrollbarSize =
      container.offsetWidth -
      container.clientWidth -
      parseFloat(computed.borderLeftWidth) -
      parseFloat(computed.borderRightWidth);
    // The offsetWidth of a root element leaves out the viewport scrollbar, so the viewport measure
    // applies only when the element has no gutter of its own.
    const document = container.ownerDocument;
    const isRootScroller = container === document.documentElement || container === document.body;
    const scrollbarSize =
      isRootScroller && elementScrollbarSize <= 0
        ? (document.defaultView?.innerWidth ?? 0) - document.documentElement.clientWidth
        : elementScrollbarSize;

    container.style.scrollbarWidth = 'none';
    if (scrollbarSize > 0) {
      container.style[paddingSide] = `${parseFloat(computed[paddingSide]) + scrollbarSize}px`;
    }

    const restoreStyles = () => {
      container.style.scrollbarWidth = scrollbarWidth;
      container.style[paddingSide] = previousPadding;
    };
    const resetPosition = () => (container.scrollTop = scrollPosition);
    container.addEventListener('scroll', resetPosition);

    const timeout = setTimeout(
      () => {
        container.removeEventListener('scroll', resetPosition);
        restoreStyles();
        cleanup = null;
      },
      typeof durationMs === 'function' ? durationMs() : durationMs,
    );

    cleanup = () => {
      clearTimeout(timeout);
      container.removeEventListener('scroll', resetPosition);
      restoreStyles();
    };
  };

  const dispose = () => {
    cleanup?.();
    cleanup = null;
  };
  return { lock, dispose };
}

/**
 * {@link createScrollLock} tied to the current injection context: the lock in progress ends when it
 * is destroyed. Returns the function that locks.
 *
 * @example
 * ```ts
 * private readonly lockScroll = injectScrollLock(inject(ElementRef), 200);
 * toggle() { this.lockScroll(); this.open.update((open) => !open); }
 * ```
 */
export function injectScrollLock(
  target: NxaScrollLockTarget,
  durationMs: number | (() => number),
): () => void {
  const { lock, dispose } = createScrollLock(target, durationMs);
  inject(DestroyRef).onDestroy(dispose);
  return lock;
}
