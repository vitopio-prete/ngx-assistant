import { DestroyRef, Directive, ElementRef, booleanAttribute, inject, input } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectThreadListItem } from '../scopes';
import {
  NXA_THREAD_LIST_COLLECTION,
  NXA_THREAD_LIST_ITEM_FOCUS,
  runThreadListAction,
} from './thread-list-state';

/**
 * A button that switches to the thread of the nearest thread list item. Carries `data-active` and
 * `aria-current` while that thread is the main one, so it can be styled without an item root. It
 * joins the arrow-key navigation of the surrounding `nxaThreadListRoot`, if any. A capture-phase
 * `click` listener can veto the switch with `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaThreadListItemTrigger><span nxaThreadListItemTitle></span></button>
 * ```
 */
@Directive({
  selector: 'button[nxaThreadListItemTrigger]',
  host: {
    type: 'button',
    '[disabled]': 'disabled()',
    '[attr.data-active]': "isMain() ? 'true' : null",
    '[attr.aria-current]': "isMain() ? 'true' : null",
    '(click)': 'onClick($event)',
  },
})
export class NxaThreadListItemTrigger {
  /** Disables the button. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly item = injectThreadListItem();
  protected readonly isMain = fromRuntime(this.item, (s) => s.isMain);

  constructor() {
    const element: HTMLButtonElement = inject(ElementRef).nativeElement;
    const collection = inject(NXA_THREAD_LIST_COLLECTION, { optional: true });
    const focus = inject(NXA_THREAD_LIST_ITEM_FOCUS, { optional: true });
    const unregister = collection?.register(element);
    if (focus) focus.trigger = element;
    inject(DestroyRef).onDestroy(() => {
      unregister?.();
      if (focus?.trigger === element) focus.trigger = null;
    });
  }

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.disabled()) return;
    runThreadListAction('Switching threads', () => this.item.switchTo());
  }
}
