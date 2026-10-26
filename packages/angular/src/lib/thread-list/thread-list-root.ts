import { Directive } from '@angular/core';
import { NXA_THREAD_LIST_COLLECTION, ThreadListCollection } from './thread-list-state';

/**
 * The root element of a thread list. It collects the item triggers inside it, so that the arrow
 * keys of `nxaThreadListItemRoot` move between them.
 *
 * @example
 * ```html
 * <nav nxaThreadListRoot>
 *   <button nxaThreadListNew>New chat</button>
 *   <div *nxaThreadListItems nxaThreadListItemRoot>...</div>
 * </nav>
 * ```
 */
@Directive({
  selector: '[nxaThreadListRoot]',
  providers: [
    { provide: NXA_THREAD_LIST_COLLECTION, useFactory: () => new ThreadListCollection() },
  ],
})
export class NxaThreadListRoot {}
