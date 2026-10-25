import { Directive, booleanAttribute, computed, input } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectMessage, injectMessageUi, injectThread } from '../scopes';

/** When the action bar hides: always unless hovered, unless it is on the last message, or never. */
export type NxaActionBarAutohide = 'always' | 'not-last' | 'never';
/** When an action bar shown by the hover floats: always, on single-branch messages, or never. */
export type NxaActionBarAutohideFloat = 'always' | 'single-branch' | 'never';
/** The visibility of an action bar. */
export type NxaActionBarStatus = 'hidden' | 'floating' | 'normal';

/**
 * The container of the actions of a message. It hides and floats by the message state and by the
 * hover tracked by `nxaMessageRoot`:
 *
 * - `hideWhenRunning` hides it while the thread runs.
 * - `autohide` hides it unless the pointer is over the message (`always`), or does so only on
 *   messages that are not the last one (`not-last`).
 * - `autohideFloat` sets `data-nxa-floating` while the hover shows an auto-hidden bar (`always`,
 *   or `single-branch` for messages with one branch), for a bar laid over the message.
 *
 * A hidden bar stays in the DOM with the `hidden` attribute; to remove it, wrap it in
 * `*nxaMessageIf`. The status is readable as `status()` through `#bar="nxaActionBarRoot"`.
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
    if (!this.ui.isHovering()) return 'hidden';

    const float = this.autohideFloat();
    return float === 'always' || (float === 'single-branch' && branchCount <= 1)
      ? 'floating'
      : 'normal';
  });
}
