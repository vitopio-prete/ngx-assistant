import { Signal, computed } from '@angular/core';
import type { ComposerRuntime, ThreadRuntime } from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';

/** Marks a composer root; its value is the composer type, `thread` or `edit`. */
export const COMPOSER_TYPE_ATTRIBUTE = 'data-nxa-composer-type';
/** Marks a thread root, which bounds where composer focus may move. */
export const THREAD_ROOT_ATTRIBUTE = 'data-nxa-thread-root';

export const COMPOSER_SELECTOR = `[${COMPOSER_TYPE_ATTRIBUTE}]`;
const THREAD_SELECTOR = `[${THREAD_ROOT_ATTRIBUTE}]`;
const CONTENT_EDITABLE_SELECTOR = "[contenteditable]:not([contenteditable='false'])";
/** The elements a composer root treats as its input. */
export const COMPOSER_INPUT_SELECTOR = `textarea:not(:disabled), ${CONTENT_EDITABLE_SELECTOR}`;

/** True for a key event that belongs to an IME composition, including Safari's post-`compositionend` key. */
export const isCompositionKey = (event: KeyboardEvent) =>
  event.isComposing || event.keyCode === 229;

/**
 * Whether the composer cannot send: the thread is disabled, the draft cannot be sent, or a run is
 * in flight and the runtime neither queues sends nor runs a voice session.
 */
export function composerSendDisabled(
  thread: ThreadRuntime,
  composer: ComposerRuntime,
): Signal<boolean> {
  const threadBlocks = fromRuntime(
    thread,
    (s) => s.isDisabled || (s.isRunning && !s.capabilities.queue && s.voice === undefined),
  );
  const canSend = fromRuntime(composer, (s) => s.canSend);
  return computed(() => threadBlocks() || !canSend());
}

/** Whether typing is blocked: the thread is disabled or dictation holds the input. */
export function composerInputDisabled(
  thread: ThreadRuntime,
  composer: ComposerRuntime,
): Signal<boolean> {
  const threadDisabled = fromRuntime(thread, (s) => s.isDisabled);
  const dictationHolds = fromRuntime(composer, (s) => s.dictation?.inputDisabled === true);
  return computed(() => threadDisabled() || dictationHolds());
}

/**
 * Cancels the composer. When the cancel ends an edit that held the focus, the focus moves to the
 * thread composer of the same thread root, unless something else took it meanwhile.
 * `source` is the element that triggered the cancel, `null` for a pointer activation.
 */
export function cancelWithFocus(composer: ComposerRuntime, source: HTMLElement | null) {
  const doc = source?.ownerDocument;
  const active = doc?.activeElement;
  const root = source?.closest<HTMLElement>(THREAD_SELECTOR);
  const editRoot = source?.closest(COMPOSER_SELECTOR);
  const shouldRestore =
    composer.getState().type === 'edit' &&
    !!root &&
    !!active &&
    editRoot?.getAttribute(COMPOSER_TYPE_ATTRIBUTE) === 'edit' &&
    editRoot.contains(active) &&
    editRoot.closest(THREAD_SELECTOR) === root;
  // Collected before cancelling: the cancel may remove the edit composer from the DOM.
  const candidates = shouldRestore
    ? Array.from(root.querySelectorAll<HTMLElement>(COMPOSER_INPUT_SELECTOR)).filter(
        (input) =>
          input.closest(THREAD_SELECTOR) === root &&
          input.closest(COMPOSER_SELECTOR)?.getAttribute(COMPOSER_TYPE_ATTRIBUTE) === 'thread',
      )
    : [];

  composer.cancel();

  if (!doc || !active || !shouldRestore) return;
  if (doc.activeElement !== active && doc.activeElement !== doc.body) return;
  for (const input of candidates) {
    if (!input.isConnected || input.closest('[hidden], [inert]')) continue;
    input.focus({ preventScroll: true });
    if (doc.activeElement !== active && doc.activeElement !== doc.body) break;
  }
}

/**
 * Whether a run start may move the focus to `input`: nothing is focused, or the focus is in the
 * same composer root or in the same thread root (not a nested one). An input that already has the
 * focus keeps it, with its selection.
 */
export function mayTakeFocusOnRunStart(input: HTMLElement) {
  const doc = input.ownerDocument;
  const active = doc.activeElement;
  if (active === input) return false;
  if (!active || active === doc.body) return true;
  if (input.closest(COMPOSER_SELECTOR)?.contains(active)) return true;
  const root = input.closest(THREAD_SELECTOR);
  return !!root && root.contains(active) && active.closest(THREAD_SELECTOR) === root;
}
