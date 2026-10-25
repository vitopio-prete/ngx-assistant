import { Directive, inject } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectThreadListItem } from '../scopes';
import {
  NXA_THREAD_LIST_COLLECTION,
  NXA_THREAD_LIST_ITEM_FOCUS,
  type ThreadListItemFocus,
} from './thread-list-state';

/**
 * The root element of a thread list item. Carries `data-active` and `aria-current` while its
 * thread is the main one.
 *
 * Inside a `nxaThreadListRoot`, ArrowDown and ArrowUp on the item's trigger move the focus to the
 * next or previous enabled trigger of the list, in document order, without wrapping. Keys with a modifier
 * are left alone. A `keydown` listener on the trigger, or a capture-phase one on the root, can
 * veto the move with `preventDefault()`.
 *
 * @example
 * ```html
 * <div *nxaThreadListItems nxaThreadListItemRoot>
 *   <button nxaThreadListItemTrigger>...</button>
 * </div>
 * ```
 */
@Directive({
  selector: '[nxaThreadListItemRoot]',
  providers: [
    {
      provide: NXA_THREAD_LIST_ITEM_FOCUS,
      useFactory: (): ThreadListItemFocus => ({ trigger: null }),
    },
  ],
  host: {
    '[attr.data-active]': "isMain() ? 'true' : null",
    '[attr.aria-current]': "isMain() ? 'true' : null",
    '(keydown)': 'onKeydown($event)',
  },
})
export class NxaThreadListItemRoot {
  protected readonly isMain = fromRuntime(injectThreadListItem(), (s) => s.isMain);
  private readonly focus = inject(NXA_THREAD_LIST_ITEM_FOCUS, { self: true })!;
  private readonly collection = inject(NXA_THREAD_LIST_COLLECTION, { optional: true });

  protected onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || !this.collection) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const trigger = this.focus.trigger;
    if (!trigger || event.target !== trigger) return;
    // Disabled triggers cannot take the focus, so the keys go past them.
    const triggers = this.collection
      .ordered()
      .filter((candidate) => candidate === trigger || !candidate.disabled);
    const next = triggers[triggers.indexOf(trigger) + (event.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    next.focus();
    event.preventDefault();
  }
}
