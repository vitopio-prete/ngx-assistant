import { Directive, computed, input } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectThreadListItem } from '../scopes';

/**
 * Renders the title of the nearest thread list item as the element's text, or `fallback` while
 * the title is missing or empty. `title()` (`exportAs: 'nxaThreadListItemTitle'`) gives the title
 * for a custom rendering.
 *
 * @example
 * ```html
 * <span nxaThreadListItemTitle fallback="New chat"></span>
 * ```
 */
@Directive({
  selector: '[nxaThreadListItemTitle]',
  exportAs: 'nxaThreadListItemTitle',
  host: { '[textContent]': 'text()' },
})
export class NxaThreadListItemTitle {
  /** The text shown while the thread has no title. */
  readonly fallback = input('');

  /** The thread's title, `undefined` while it has none. */
  readonly title = fromRuntime(injectThreadListItem(), (s) => s.title);
  protected readonly text = computed(() => this.title() || this.fallback());
}
