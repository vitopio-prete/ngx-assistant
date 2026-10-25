import {
  DestroyRef,
  Directive,
  ElementRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectComposer, injectThread } from '../scopes';

const isFileDrag = (event: DragEvent) => event.dataTransfer?.types.includes('Files') === true;

/**
 * A drop target that adds dropped files to the nearest composer. `data-nxa-dragging` is set while
 * a file drag is over it. File drags are always claimed with `preventDefault()`, even when the
 * dropzone is disabled or the runtime has no `attachments` capability, because an unclaimed file
 * drop makes the browser open the file; then the drop effect is `none` and nothing is added.
 * Other drags pass through. The listeners run in the capture phase, so a descendant that handles
 * drops itself does not hide them from the dropzone. A file the composer rejects does not stop
 * the others.
 *
 * @example
 * ```html
 * <div nxaComposerAttachmentDropzone>
 *   <form nxaComposerRoot>...</form>
 * </div>
 * ```
 */
@Directive({
  selector: '[nxaComposerAttachmentDropzone]',
  host: { '[attr.data-nxa-dragging]': "isDragging() ? '' : null" },
})
export class NxaComposerAttachmentDropzone {
  /** Disables the dropzone. File drags are still claimed, so they do not open the file. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly thread = injectThread();
  private readonly composer = injectComposer();
  private readonly threadDisabled = fromRuntime(this.thread, (s) => s.isDisabled);
  private readonly isDisabled = computed(() => this.disabled() || this.threadDisabled());
  private readonly dragging = signal(false);
  protected readonly isDragging = computed(() => this.dragging() && !this.isDisabled());

  constructor() {
    const element: HTMLElement = inject(ElementRef).nativeElement;
    const listeners: [string, (event: DragEvent) => void][] = [
      ['dragenter', (event) => this.onDragOver(event)],
      ['dragover', (event) => this.onDragOver(event)],
      ['dragleave', (event) => this.onDragLeave(event)],
      ['drop', (event) => void this.onDrop(event)],
    ];
    for (const [type, listener] of listeners) {
      element.addEventListener(type, listener as EventListener, { capture: true });
    }
    inject(DestroyRef).onDestroy(() => {
      for (const [type, listener] of listeners) {
        element.removeEventListener(type, listener as EventListener, { capture: true });
      }
    });
    // A disabled dropzone ignores drag events, so it could not clear the highlight by itself.
    effect(() => {
      if (this.isDisabled()) this.dragging.set(false);
    });
  }

  private accepts() {
    return !this.isDisabled() && this.thread.getState().capabilities.attachments;
  }

  private onDragOver(event: DragEvent) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (!this.accepts()) {
      event.dataTransfer!.dropEffect = 'none';
      return;
    }
    this.dragging.set(true);
  }

  private onDragLeave(event: DragEvent) {
    if (!isFileDrag(event)) return;
    const next = event.relatedTarget as Node | null;
    if (next && (event.currentTarget as Node).contains(next)) return;
    this.dragging.set(false);
  }

  private async onDrop(event: DragEvent) {
    this.dragging.set(false);
    if (!isFileDrag(event)) return;
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!this.accepts() || files.length === 0) return;
    await Promise.all(
      files.map(async (file) => {
        try {
          await this.composer.addAttachment(file);
        } catch {
          // The composer reports the failure as its attachmentAddError event before rejecting.
        }
      }),
    );
  }
}
