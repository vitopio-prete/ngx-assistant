import {
  DestroyRef,
  Directive,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
} from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectMessage, injectMessageUi } from '../scopes';
import { copyDisabled } from './action-state';

/** Writes text to the clipboard. A rejection or a throw counts as a failed copy. */
export type NxaCopyToClipboard = (text: string) => void | Promise<void>;

const writeToClipboard: NxaCopyToClipboard = (text) => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return Promise.reject(new Error('Clipboard API is not available.'));
  }
  return navigator.clipboard.writeText(text);
};

/**
 * A button that copies the text of the nearest message, or the draft of its edit composer while
 * the message is being edited. After a successful copy the message is copied
 * (`injectMessageUi().isCopied`, `*nxaMessageIf="{ copied: true }"`) for `copiedDuration`
 * milliseconds, and the button carries `data-nxa-copied`. Disabled while an assistant message is
 * still running or the message has no text. A capture-phase `click` listener can veto the copy
 * with `preventDefault()`.
 *
 * The clipboard is written inside the click, so browsers that tie clipboard access to a user
 * gesture accept it. A failed write leaves the message as it was. A write that completes after the
 * button is destroyed, or after its scope moved to another message, is ignored. The copied state
 * belongs to the message, so copy buttons of the same message share it.
 *
 * @example
 * ```html
 * <button nxaActionBarCopy [copiedDuration]="2000">Copy</button>
 * ```
 */
@Directive({
  selector: 'button[nxaActionBarCopy]',
  host: {
    type: 'button',
    '[disabled]': 'isDisabled()',
    '[attr.data-nxa-copied]': "isCopied() ? '' : null",
    '(click)': 'onClick($event)',
  },
})
export class NxaActionBarCopy {
  /** How long the message stays copied, in milliseconds. */
  readonly copiedDuration = input(3000, { transform: numberAttribute });
  /** Writes the text; without one, `navigator.clipboard.writeText`. */
  readonly copyToClipboard = input<NxaCopyToClipboard | null | undefined>(undefined);
  /** Disables the button on top of the message state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly message = injectMessage();
  private readonly ui = injectMessageUi();
  private readonly messageId = fromRuntime(this.message, (s) => s.id);
  private readonly nothingToCopy = copyDisabled(this.message);
  protected readonly isDisabled = computed(() => this.disabled() || this.nothingToCopy());
  protected readonly isCopied = this.ui.isCopied;

  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped when pending writes must no longer mark the message: destroy or a new message. */
  private generation = 0;

  constructor() {
    let previousId: string | undefined;
    effect(() => {
      const id = this.messageId();
      if (previousId !== undefined && id !== previousId) this.reset();
      previousId = id;
    });
    inject(DestroyRef).onDestroy(() => this.reset());
  }

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    const { isEditing, text } = this.message.composer.getState();
    const value = isEditing ? text : this.message.unstable_getCopyText();
    if (!value) return;

    const generation = this.generation;
    const id = this.message.getState().id;
    let write: void | Promise<void>;
    try {
      write = (this.copyToClipboard() ?? writeToClipboard)(value);
    } catch {
      return;
    }
    Promise.resolve(write).then(
      () => {
        // The id check covers a message change that the effect has not seen yet.
        if (generation !== this.generation || this.message.getState().id !== id) return;
        clearTimeout(this.timer);
        this.ui.isCopied.set(true);
        this.timer = setTimeout(() => {
          this.timer = undefined;
          this.ui.isCopied.set(false);
        }, this.copiedDuration());
      },
      // A refused or missing clipboard is not an error of the app.
      () => undefined,
    );
  }

  /** Drops pending writes and ends the copied window this button opened. */
  private reset() {
    this.generation++;
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.ui.isCopied.set(false);
  }
}
