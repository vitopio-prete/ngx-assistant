import { InjectionToken } from '@angular/core';

/**
 * The item triggers under a thread list root, for the arrow keys. Triggers register themselves;
 * the order is the document order at the time of the key press, so rows moved in the DOM keep a
 * natural order.
 */
export class ThreadListCollection {
  private readonly triggers = new Set<HTMLButtonElement>();

  register(trigger: HTMLButtonElement): () => void {
    this.triggers.add(trigger);
    return () => this.triggers.delete(trigger);
  }

  ordered(): HTMLButtonElement[] {
    return [...this.triggers].sort((first, second) => {
      const position = first.compareDocumentPosition(second);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }
}

/** The trigger of one thread list item root, from which the arrow keys move the focus. */
export interface ThreadListItemFocus {
  trigger: HTMLButtonElement | null;
}

export const NXA_THREAD_LIST_COLLECTION = new InjectionToken<ThreadListCollection | null>(
  'NXA_THREAD_LIST_COLLECTION',
);

export const NXA_THREAD_LIST_ITEM_FOCUS = new InjectionToken<ThreadListItemFocus | null>(
  'NXA_THREAD_LIST_ITEM_FOCUS',
);

/** Runs a thread list action from a click; a failure is reported, not left unhandled. */
export function runThreadListAction(name: string, action: () => Promise<unknown>) {
  // A runtime may also throw before it returns a promise.
  Promise.resolve()
    .then(action)
    .catch((error: unknown) => {
      console.error(`[ngx-assistant] ${name} failed`, error);
    });
}
