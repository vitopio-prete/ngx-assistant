import {
  DestroyRef,
  Directive,
  DOCUMENT,
  booleanAttribute,
  computed,
  inject,
  input,
} from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectComposer, injectThread } from '../scopes';

/**
 * A button that opens a file picker and adds the chosen files to the nearest composer. The
 * picker accepts the composer's `attachmentAccept` and, unless `multiple` is `false`, several
 * files. Disabled while the thread is disabled or the composer is not editing. A capture-phase
 * `click` listener can veto the picker with `preventDefault()`.
 *
 * The files go to the thread that opened the picker: when the main thread changes (even back to
 * the same thread), the button is destroyed or becomes disabled before the choice, nothing is
 * added. A file the composer rejects does not stop the
 * others; the composer reports it as its `attachmentAddError` event.
 *
 * @example
 * ```html
 * <button nxaComposerAddAttachment aria-label="Add attachment">+</button>
 * ```
 */
@Directive({
  selector: 'button[nxaComposerAddAttachment]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaComposerAddAttachment {
  /** Whether the picker accepts several files. */
  readonly multiple = input(true, { transform: booleanAttribute });
  /** Disables the button on top of the composer state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly document = inject(DOCUMENT);
  private readonly thread = injectThread();
  private readonly composer = injectComposer();
  private readonly threadDisabled = fromRuntime(this.thread, (s) => s.isDisabled);
  private readonly editing = fromRuntime(this.composer, (s) => s.isEditing);
  private readonly blocked = computed(() => this.threadDisabled() || !this.editing());
  protected readonly isDisabled = computed(() => this.disabled() || this.blocked());

  private destroyed = false;
  // Counts the changes of the main thread: a picker adds only if none happened while it was open.
  private threadGeneration = 0;
  private readonly pickers = new Set<HTMLInputElement>();

  constructor() {
    let threadId = this.thread.getState().threadId;
    const unsubscribe = this.thread.subscribe(() => {
      const next = this.thread.getState().threadId;
      if (next === threadId) return;
      threadId = next;
      this.threadGeneration++;
    });
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      this.destroyed = true;
      for (const picker of this.pickers) picker.remove();
      this.pickers.clear();
    });
  }

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;

    const generation = this.threadGeneration;
    const picker = this.document.createElement('input');
    picker.type = 'file';
    picker.multiple = this.multiple();
    picker.hidden = true;
    const accept = this.composer.getState().attachmentAccept;
    if (accept !== '*') picker.accept = accept;

    const close = () => {
      picker.remove();
      this.pickers.delete(picker);
    };
    picker.onchange = async () => {
      const files = Array.from(picker.files ?? []);
      close();
      if (this.destroyed || this.threadGeneration !== generation || this.isDisabled()) return;
      await Promise.all(
        files.map(async (file) => {
          try {
            await this.composer.addAttachment(file);
          } catch {
            // The composer reports the failure as its attachmentAddError event before rejecting.
          }
        }),
      );
    };
    picker.oncancel = close;

    this.document.body.appendChild(picker);
    this.pickers.add(picker);
    picker.click();
  }
}
