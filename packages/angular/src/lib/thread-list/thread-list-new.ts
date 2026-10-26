import { Directive, booleanAttribute, input } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectThreadList } from '../scopes';
import { runThreadListAction } from './thread-list-state';

/**
 * A button that switches to a new thread. Carries `data-active` and `aria-current` while the new
 * thread is the main one. A capture-phase `click` listener can veto the switch with
 * `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaThreadListNew>New chat</button>
 * ```
 */
@Directive({
  selector: 'button[nxaThreadListNew]',
  host: {
    type: 'button',
    '[disabled]': 'disabled()',
    '[attr.data-active]': "isActive() ? 'true' : null",
    '[attr.aria-current]': "isActive() ? 'true' : null",
    '(click)': 'onClick($event)',
  },
})
export class NxaThreadListNew {
  /** Disables the button. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly threads = injectThreadList();
  protected readonly isActive = fromRuntime(
    this.threads,
    (s) => s.newThreadId !== undefined && s.newThreadId === s.mainThreadId,
  );

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.disabled()) return;
    runThreadListAction('Switching to a new thread', () => this.threads.switchToNewThread());
  }
}
