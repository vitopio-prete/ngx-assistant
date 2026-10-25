import { Directive, booleanAttribute, computed, input } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectThreadList } from '../scopes';
import { runThreadListAction } from './thread-list-state';

/**
 * A button that loads more threads. It stays in place, disabled, while there are no more threads
 * or a load is in flight. A capture-phase `click` listener can veto the load with
 * `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaThreadListLoadMore>Load more</button>
 * ```
 */
@Directive({
  selector: 'button[nxaThreadListLoadMore]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaThreadListLoadMore {
  /** Disables the button on top of the thread list state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly threads = injectThreadList();
  private readonly blocked = fromRuntime(
    this.threads,
    (s) => !s.hasMore || s.isLoading || s.isLoadingMore,
  );
  protected readonly isDisabled = computed(() => this.disabled() || this.blocked());

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    runThreadListAction('Loading more threads', () => this.threads.loadMore());
  }
}
