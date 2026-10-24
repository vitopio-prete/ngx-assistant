import {
  DestroyRef,
  Directive,
  ElementRef,
  afterRenderEffect,
  booleanAttribute,
  computed,
  inject,
  input,
  untracked,
} from '@angular/core';
import { injectNxaEvent } from '../events';
import { fromRuntime } from '../from-runtime';
import { injectAssistant, injectComposer, injectThread } from '../scopes';
import { NXA_THREAD_VIEWPORT } from '../thread/thread-viewport';
import {
  COMPOSER_SELECTOR,
  cancelWithFocus,
  composerInputDisabled,
  composerSendDisabled,
  isCompositionKey,
  mayTakeFocusOnRunStart,
} from './composer-state';

/**
 * How the keyboard sends the composer: `enter` on plain Enter (Shift+Enter inserts a newline),
 * `ctrlEnter` on Ctrl/Cmd+Enter (plain Enter inserts a newline), `none` never.
 */
export type NxaSubmitMode = 'enter' | 'ctrlEnter' | 'none';

/**
 * A textarea bound to the composer text.
 *
 * - Enter sends according to `submitMode`. An Enter that cannot send, because the draft is empty
 *   or a run is in flight without a queue, is left to the textarea, which inserts a newline. Keys that belong to an IME
 *   composition never send. With the `queue` capability, Ctrl/Cmd+Shift+Enter sends the draft
 *   ahead of the queue (steer), unless `submitMode` is `none`.
 * - Inside a `<form nxaComposerRoot>` the send goes through the form's submit, so submit listeners
 *   see it.
 * - Escape cancels the composer when it can: it ends an edit, or stops the run of a thread
 *   composer. Disable it with `cancelOnEscape="false"`.
 * - Pasted files become attachments when the thread accepts them.
 * - The textarea always shows the composer text: a change the runtime normalizes or rejects is
 *   written back. Disabled while the thread is disabled or dictation holds the input. While the
 *   composer is not editing (an edit composer before `beginEdit`), typing and pasting are ignored.
 * - With `autoFocus`, the input takes the focus when it appears, when the thread composer starts
 *   a run, when the thread list switches threads and when `nxaScrollToBottom` (or the viewport's
 *   `scrollToBottom()`) scrolls the surrounding thread viewport.
 *
 * A capture-phase `keydown` or `paste` listener can veto the primitive with `preventDefault()`.
 *
 * @example
 * ```html
 * <textarea nxaComposerInput aria-label="Message" autoFocus></textarea>
 * ```
 */
@Directive({
  selector: 'textarea[nxaComposerInput]',
  host: {
    '[value]': 'value()',
    '[disabled]': 'isDisabled()',
    '(input)': 'onInput()',
    '(compositionstart)': 'composing = true',
    '(compositionend)': 'composing = false; onInput()',
    '(keydown)': 'onKeydown($event)',
    '(paste)': 'onPaste($event)',
  },
})
export class NxaComposerInput {
  /** How the keyboard sends the composer. */
  readonly submitMode = input<NxaSubmitMode>('enter');
  /** Whether Escape cancels the composer. */
  readonly cancelOnEscape = input(true, { transform: booleanAttribute });
  /** Whether pasted files become attachments. */
  readonly addAttachmentOnPaste = input(true, { transform: booleanAttribute });
  /** Whether the input takes the focus when it appears. */
  readonly autoFocus = input(false, { transform: booleanAttribute });
  /** With `autoFocus`, whether a run start of the thread composer moves the focus here. */
  readonly focusOnRunStart = input(true, { transform: booleanAttribute });
  /** With `autoFocus`, whether switching threads moves the focus here. */
  readonly focusOnThreadSwitched = input(true, { transform: booleanAttribute });
  /** With `autoFocus`, whether scrolling the thread viewport to the bottom moves the focus here. */
  readonly focusOnScrollToBottom = input(true, { transform: booleanAttribute });
  /** Disables the input on top of the composer state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly element: HTMLTextAreaElement = inject(ElementRef).nativeElement;
  private readonly thread = injectThread();
  private readonly composer = injectComposer();
  private readonly sendDisabled = composerSendDisabled(this.thread, this.composer);
  private readonly inputDisabled = composerInputDisabled(this.thread, this.composer);
  protected readonly value = fromRuntime(this.composer, (s) => (s.isEditing ? s.text : ''));
  protected readonly isDisabled = computed(() => this.disabled() || this.inputDisabled());
  private readonly autoFocusEnabled = computed(() => this.autoFocus() && !this.isDisabled());
  // Notifies on every runtime change, so a text set back to an earlier value is still written.
  private readonly text = fromRuntime(this.composer, (s) => (s.isEditing ? s.text : ''), {
    equal: () => false,
  });
  protected composing = false;

  constructor() {
    // `[value]` writes only when the bound value changes, not when the DOM drifts from it.
    afterRenderEffect(() => {
      const text = this.text();
      if (!this.composing && this.element.value !== text) this.element.value = text;
    });
    afterRenderEffect(() => {
      if (this.autoFocusEnabled()) untracked(() => this.focus());
    });

    const isThreadComposer = this.composer.getState().type === 'thread';
    if (isThreadComposer) {
      injectNxaEvent('thread.runStart', () => {
        if (!this.autoFocusEnabled() || !this.focusOnRunStart()) return;
        if (mayTakeFocusOnRunStart(this.element)) this.focus();
      });
      if (injectAssistant({ optional: true })) {
        injectNxaEvent('threads.selectionChanged', () => {
          if (this.focusOnThreadSwitched()) this.focus();
        });
      }
      const viewport = inject(NXA_THREAD_VIEWPORT, { optional: true });
      if (viewport) {
        const remove = viewport.onScrollToBottom(() => {
          if (this.focusOnScrollToBottom()) this.focus();
        });
        inject(DestroyRef).onDestroy(remove);
      }
    }
  }

  protected onInput() {
    if (!this.composer.getState().isEditing) {
      this.element.value = this.value();
      return;
    }
    if (this.element.value !== this.composer.getState().text) {
      this.composer.setText(this.element.value);
    }
    // A runtime that normalizes or rejects the text keeps the textarea in step.
    const text = this.composer.getState().text;
    if (!this.composing && this.element.value !== text) this.element.value = text;
  }

  protected onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || isCompositionKey(event)) return;

    if (event.key === 'Escape') {
      if (!this.cancelOnEscape() || !this.composer.getState().canCancel) return;
      event.preventDefault();
      cancelWithFocus(this.composer, this.element);
      return;
    }

    if (event.key !== 'Enter' || this.isDisabled()) return;
    const mode = this.submitMode();
    const modifier = event.ctrlKey || event.metaKey;

    if (event.shiftKey) {
      // Steer: send ahead of the queued messages.
      if (
        modifier &&
        mode !== 'none' &&
        this.thread.getState().capabilities.queue &&
        this.composer.getState().canSend
      ) {
        event.preventDefault();
        this.composer.send({ steer: true });
      }
      return;
    }

    const shouldSend = mode === 'enter' || (mode === 'ctrlEnter' && modifier);
    if (!shouldSend || this.sendDisabled()) return;
    event.preventDefault();
    // Through the form's submit, so its submit listeners see the send. tagName rather than
    // instanceof: the element may come from another window.
    const root = this.element.closest<HTMLElement>(COMPOSER_SELECTOR);
    if (root?.tagName === 'FORM') (root as HTMLFormElement).requestSubmit();
    else this.composer.send();
  }

  protected onPaste(event: ClipboardEvent) {
    if (event.defaultPrevented || !this.addAttachmentOnPaste()) return;
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0 || !this.thread.getState().capabilities.attachments) return;
    if (!this.composer.getState().isEditing) return;
    event.preventDefault();
    for (const file of files) {
      // A failure is reported as the composer's attachmentAddError event before it rejects.
      this.composer.addAttachment(file).catch(() => undefined);
    }
  }

  private focus() {
    if (!this.autoFocusEnabled()) return;
    this.element.focus({ preventScroll: true });
    const end = this.element.value.length;
    this.element.setSelectionRange(end, end);
  }
}
