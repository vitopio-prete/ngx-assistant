import { Directive, booleanAttribute, computed, input } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectThreadList, injectThreadListItem } from '../scopes';
import { runThreadListAction } from './thread-list-state';

/**
 * A button that archives the thread of the nearest thread list item. A capture-phase `click`
 * listener can veto it with `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaThreadListItemArchive>Archive</button>
 * ```
 */
@Directive({
  selector: 'button[nxaThreadListItemArchive]',
  host: { type: 'button', '[disabled]': 'disabled()', '(click)': 'onClick($event)' },
})
export class NxaThreadListItemArchive {
  /** Disables the button. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly item = injectThreadListItem();

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.disabled()) return;
    runThreadListAction('Archiving the thread', () => this.item.archive());
  }
}

/**
 * A button that restores the archived thread of the nearest thread list item. Disabled while the
 * thread list cannot restore threads; `disabled` only adds to that. A capture-phase `click`
 * listener can veto it with `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaThreadListItemUnarchive>Restore</button>
 * ```
 */
@Directive({
  selector: 'button[nxaThreadListItemUnarchive]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaThreadListItemUnarchive {
  /** Disables the button on top of the thread list state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly item = injectThreadListItem();
  private readonly unsupported = fromRuntime(injectThreadList(), (s) => !s.canUnarchive);
  protected readonly isDisabled = computed(() => this.disabled() || this.unsupported());

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    runThreadListAction('Restoring the thread', () => this.item.unarchive());
  }
}

/**
 * A button that deletes the thread of the nearest thread list item. A capture-phase `click`
 * listener can veto it with `preventDefault()`, for example to ask for a confirmation.
 *
 * @example
 * ```html
 * <button nxaThreadListItemDelete>Delete</button>
 * ```
 */
@Directive({
  selector: 'button[nxaThreadListItemDelete]',
  host: { type: 'button', '[disabled]': 'disabled()', '(click)': 'onClick($event)' },
})
export class NxaThreadListItemDelete {
  /** Disables the button. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly item = injectThreadListItem();

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.disabled()) return;
    runThreadListAction('Deleting the thread', () => this.item.delete());
  }
}
