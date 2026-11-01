import { Directive, booleanAttribute, computed, input } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectMessage, injectMessageUi, injectThread } from '../scopes';

/**
 * When the action bar hides: always unless the message is hovered or holds the keyboard focus, only
 * on messages that are not the last one, or never.
 */
export type NxaActionBarAutohide = 'always' | 'not-last' | 'never';
/** When an action bar shown by the hover floats: always, on single-branch messages, or never. */
export type NxaActionBarAutohideFloat = 'always' | 'single-branch' | 'never';
/**
 * The visibility of an action bar: `hidden` while the thread runs (`hideWhenRunning`),
 * `autohidden` while `autohide` keeps it out of sight, `floating` or `normal` when it shows.
 */
export type NxaActionBarStatus = 'hidden' | 'autohidden' | 'floating' | 'normal';

/**
 * The container of the actions of a message. It hides and floats by the message state and by the
 * hover and keyboard focus tracked by `nxaMessageRoot`:
 *
 * - `hideWhenRunning` hides it while the thread runs, with the `hidden` attribute.
 * - `autohide` keeps it out of sight unless the pointer is over the message or the keyboard focus
 *   is inside it (`always`), or does so only on messages that are not the last one (`not-last`).
 *   The bar then carries `data-nxa-autohidden` and no `hidden`, so that its buttons stay in the tab
 *   order: tabbing into one puts the focus inside the message, which shows the bar. Hide it with
 *   CSS that keeps it focusable, such as `[data-nxa-autohidden] { opacity: 0; }`.
 * - `autohideFloat` sets `data-nxa-floating` while the hover or the focus shows an auto-hidden bar
 *   (`always`, or `single-branch` for messages with one branch), for a bar laid over the message.
 *
 * A hidden bar stays in the DOM; to remove it, wrap it in `*nxaMessageIf`. The status is readable
 * as `status()` through `#bar="nxaActionBarRoot"`.
 *
 * @example
 * ```html
 * <div nxaActionBarRoot autohide="not-last" autohideFloat="single-branch">
 *   <button nxaActionBarCopy>Copy</button>
 *   <button nxaActionBarReload>Regenerate</button>
 * </div>
 * ```
 */
@Directive({
  selector: '[nxaActionBarRoot]',
  exportAs: 'nxaActionBarRoot',
  host: {
    '[attr.hidden]': "status() === 'hidden' ? '' : null",
    '[attr.data-nxa-autohidden]': "status() === 'autohidden' ? '' : null",
    '[attr.data-nxa-floating]': "status() === 'floating' ? '' : null",
  },
})
export class NxaActionBarRoot {
  readonly hideWhenRunning = input(false, { transform: booleanAttribute });
  readonly autohide = input<NxaActionBarAutohide>('never');
  readonly autohideFloat = input<NxaActionBarAutohideFloat>('never');

  private readonly isRunning = fromRuntime(injectThread(), (s) => s.isRunning);
  private readonly message = fromRuntime(injectMessage(), (s) => ({
    isLast: s.isLast,
    branchCount: s.branchCount,
  }));
  private readonly ui = injectMessageUi();

  readonly status = computed((): NxaActionBarStatus => {
    if (this.hideWhenRunning() && this.isRunning()) return 'hidden';

    const autohide = this.autohide();
    const { isLast, branchCount } = this.message();
    if (autohide !== 'always' && (autohide !== 'not-last' || isLast)) return 'normal';
    if (!this.ui.isHovering() && !this.ui.isFocusWithin()) return 'autohidden';

    const float = this.autohideFloat();
    return float === 'always' || (float === 'single-branch' && branchCount <= 1)
      ? 'floating'
      : 'normal';
  });
}
