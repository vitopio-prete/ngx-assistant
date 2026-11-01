import { signal } from '@angular/core';

/** A size of the modal, in CSS pixels. */
export interface ModalSize {
  readonly width: number;
  readonly height: number;
}

interface ResizeDrag {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly direction: 1 | -1;
  last: ModalSize | null;
}

/** Where the size the user picked is remembered. */
export const MODAL_SIZE_STORAGE_KEY = 'nxa-modal-size';
const MIN_SIZE: ModalSize = { width: 320, height: 400 };
// The launcher and its offsets sit below the modal, so the height leaves room for them.
const VIEWPORT_INSET: ModalSize = { width: 32, height: 96 };
const RESIZE_STEP = 16;

const clampSize = ({ width, height }: ModalSize): ModalSize => ({
  width: Math.round(
    Math.max(MIN_SIZE.width, Math.min(width, window.innerWidth - VIEWPORT_INSET.width)),
  ),
  height: Math.round(
    Math.max(MIN_SIZE.height, Math.min(height, window.innerHeight - VIEWPORT_INSET.height)),
  ),
});

const readStoredSize = (): ModalSize | null => {
  try {
    const stored: unknown = JSON.parse(
      window.localStorage.getItem(MODAL_SIZE_STORAGE_KEY) ?? 'null',
    );
    if (typeof stored !== 'object' || stored === null) return null;
    const { width, height } = stored as Record<string, unknown>;
    if (typeof width !== 'number' || typeof height !== 'number') return null;
    return clampSize({ width, height });
  } catch {
    return null;
  }
};

const storeSize = (size: ModalSize | null) => {
  try {
    if (size) window.localStorage.setItem(MODAL_SIZE_STORAGE_KEY, JSON.stringify(size));
    else window.localStorage.removeItem(MODAL_SIZE_STORAGE_KEY);
  } catch {
    // Without storage the size lasts until the page reloads.
  }
};

const isRtl = (element: Element) => getComputedStyle(element).direction === 'rtl';

/**
 * The size of the modal and the handlers of its resize handle, which sits in the top corner on
 * the start side: dragging it grows the modal up and toward the start; the arrow keys grow or
 * shrink it by 16 pixels (64 with Shift); Enter, Space or a double click go back to the default
 * size. `null` is the default size of the stylesheet. A size the user picks is kept within the
 * viewport and remembered in `localStorage`.
 */
export class ModalSizeController {
  /** The size picked by the user, `null` for the default. */
  readonly size = signal<ModalSize | null>(readStoredSize());
  private drag: ResizeDrag | null = null;

  /** @param content The element whose size changes. */
  constructor(private readonly content: () => HTMLElement | undefined) {}

  private commit(next: ModalSize | null) {
    this.size.set(next);
    storeSize(next);
  }

  private fromPointer(drag: ResizeDrag, event: PointerEvent) {
    return clampSize({
      width: drag.width - (event.clientX - drag.x) * drag.direction,
      height: drag.height - (event.clientY - drag.y),
    });
  }

  private take(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return null;
    this.drag = null;
    return drag;
  }

  /** Goes back to the default size and forgets the remembered one. */
  reset() {
    this.drag = null;
    this.commit(null);
  }

  pointerDown(event: PointerEvent) {
    const content = this.content();
    if (event.button !== 0 || !content) return;
    const rect = content.getBoundingClientRect();
    this.drag = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: rect.width,
      height: rect.height,
      direction: isRtl(content) ? -1 : 1,
      last: null,
    };
    (event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  pointerMove(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // A press without movement is a click, not a resize.
    if (!drag.last && event.clientX === drag.x && event.clientY === drag.y) return;
    drag.last = this.fromPointer(drag, event);
    this.size.set(drag.last);
  }

  pointerUp(event: PointerEvent) {
    const drag = this.take(event);
    if (!drag) return;
    if (drag.last || event.clientX !== drag.x || event.clientY !== drag.y) {
      this.commit(this.fromPointer(drag, event));
    }
  }

  pointerCancel(event: PointerEvent) {
    const drag = this.take(event);
    if (drag?.last) this.commit(drag.last);
  }

  keyDown(event: KeyboardEvent) {
    const content = this.content();
    if (!content) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.reset();
      return;
    }
    const step = event.shiftKey ? RESIZE_STEP * 4 : RESIZE_STEP;
    const rtl = isRtl(content);
    const changes: Record<string, readonly [number, number]> = {
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
      [rtl ? 'ArrowRight' : 'ArrowLeft']: [step, 0],
      [rtl ? 'ArrowLeft' : 'ArrowRight']: [-step, 0],
    };
    const change = changes[event.key];
    if (!change) return;
    event.preventDefault();
    const rect = content.getBoundingClientRect();
    this.commit(clampSize({ width: rect.width + change[0], height: rect.height + change[1] }));
  }
}
