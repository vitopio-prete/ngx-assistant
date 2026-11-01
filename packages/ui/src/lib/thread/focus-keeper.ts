import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

const isUsable = (element: HTMLElement) =>
  element.isConnected &&
  !element.matches(':disabled') &&
  element.closest('[hidden], [inert]') === null;

const follows = (reference: Node, node: Node) =>
  !!(reference.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);

/**
 * Where a removed element was: before `next`, after `previous`, or at the start of `parent`. The
 * returned test tells whether a candidate comes at or after that place.
 */
function placeOfRemoval(lost: HTMLElement, records: readonly MutationRecord[]) {
  for (const record of records) {
    const removed = [...record.removedNodes].find((node) => node === lost || node.contains(lost));
    if (!removed) continue;
    const { nextSibling: next, previousSibling: previous, target: parent } = record;
    if (next?.isConnected) {
      return (candidate: Node) =>
        candidate === next || next.contains(candidate) || follows(next, candidate);
    }
    if (previous?.isConnected) {
      return (candidate: Node) => !previous.contains(candidate) && follows(previous, candidate);
    }
    if (parent.isConnected) {
      return (candidate: Node) => parent.contains(candidate) || follows(parent, candidate);
    }
  }
  return null;
}

/**
 * Keeps the keyboard focus inside the thread when the control that holds it goes away: a button
 * removed or disabled while a run starts, an approval answered, an edit form saved. The focus
 * moves to the next control in tab order instead of falling back to the page. A focus the user
 * moved out of the thread on purpose is left alone.
 */
@Directive({ selector: '[nxaFocusKeeper]' })
export class NxaFocusKeeper {
  constructor() {
    const root: HTMLElement = inject(ElementRef).nativeElement;
    let focused: HTMLElement | null = null;

    const onFocusIn = (event: FocusEvent) => {
      focused = event.target instanceof HTMLElement ? event.target : null;
    };
    // Leaving a control that is still there is the user's choice (a click elsewhere, another
    // window): nothing to keep any more.
    const onFocusOut = (event: FocusEvent) => {
      if (event.target === focused && focused && isUsable(focused)) focused = null;
    };

    const rescue = (records: MutationRecord[]) => {
      const lost = focused;
      if (!lost || isUsable(lost)) return;
      const active = root.ownerDocument.activeElement;
      if (active && active !== root.ownerDocument.body && active !== lost) return;
      focused = null;
      const after = lost.isConnected
        ? (candidate: Node) => follows(lost, candidate)
        : placeOfRemoval(lost, records);
      const candidates = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isUsable);
      const next = (after && candidates.find(after)) ?? candidates.at(-1);
      next?.focus({ preventScroll: true });
    };

    // A change often comes in steps (a button disabled, then removed, then its replacement
    // added): the focus moves once the DOM has settled, with every step seen.
    let pending: MutationRecord[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver((records) => {
      pending.push(...records);
      timer ??= setTimeout(() => {
        timer = null;
        const records = [...pending, ...observer.takeRecords()];
        pending = [];
        rescue(records);
      });
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden', 'inert'],
    });
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
    });
  }
}
