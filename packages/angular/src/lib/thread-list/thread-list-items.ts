import {
  DestroyRef,
  Directive,
  Injector,
  TemplateRef,
  ViewContainerRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import type { ThreadListItemRuntime, ThreadListItemRuntimeState } from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';
import { KeyedViews, type NxaRowContext } from '../messages/keyed-views';
import { injectThreadList, provideThreadListItemScope } from '../scopes';

/** The template context of `*nxaThreadListItems`: `let thread` is a `Signal` of the item state. */
export type NxaThreadListItemsContext = NxaRowContext<ThreadListItemRuntimeState>;

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Renders its template once per thread of the thread list, or once per archived thread with
 * `archived: true`. Each row is a thread list item scope: inside it `injectThreadListItem()` is
 * the row's thread.
 *
 * Rows follow the thread id. A thread keeps its row, and the row keeps its state, when threads
 * before it are archived, deleted or added; a new id creates a new row. The context gives
 * `let thread` (a `Signal` of the item state), `index`, `count`, `first` and `last`.
 *
 * @example
 * ```html
 * <div *nxaThreadListItems="let thread" nxaThreadListItemRoot>
 *   <button nxaThreadListItemTrigger><span nxaThreadListItemTitle fallback="New chat"></span></button>
 * </div>
 * <div *nxaThreadListItems="let thread; archived: true">{{ thread().title }}</div>
 * ```
 */
@Directive({ selector: '[nxaThreadListItems]' })
export class NxaThreadListItems {
  /** Renders the archived threads instead of the regular ones. */
  readonly archived = input(false, {
    alias: 'nxaThreadListItemsArchived',
    transform: booleanAttribute,
  });

  private readonly threads = injectThreadList();
  private readonly lists = fromRuntime(this.threads, (s) => s);
  private readonly ids = computed(
    () => {
      const state = this.lists();
      return this.archived() ? state.archivedThreadIds : state.threadIds;
    },
    { equal: sameIds },
  );

  // Types the template context; `ctx` is only used in the type predicate.
  static ngTemplateContextGuard(
    _dir: NxaThreadListItems,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ctx: unknown,
  ): ctx is NxaThreadListItemsContext {
    return true;
  }

  constructor() {
    const views = new KeyedViews<ThreadListItemRuntimeState, ThreadListItemRuntime>(
      inject(ViewContainerRef),
      inject(TemplateRef<NxaThreadListItemsContext>),
      inject(Injector),
      provideThreadListItemScope,
    );
    effect(() => {
      const threads = this.threads;
      views.update(this.ids().map((id) => ({ key: id, create: () => threads.getItemById(id) })));
    });
    inject(DestroyRef).onDestroy(() => views.clear());
  }
}
