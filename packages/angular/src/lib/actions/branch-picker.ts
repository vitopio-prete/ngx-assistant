import { Directive, booleanAttribute, computed, input } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectMessage, injectThread } from '../scopes';
import { branchDisabled } from './action-state';

/**
 * The container of the branch controls of the nearest message. With `hideWhenSingleBranch` it
 * carries the `hidden` attribute while the message has a single branch; to remove it instead,
 * wrap it in `*nxaMessageIf="{ hasBranches: true }"`.
 *
 * @example
 * ```html
 * <div nxaBranchPickerRoot hideWhenSingleBranch>
 *   <button nxaBranchPickerPrevious aria-label="Previous">‹</button>
 *   <span nxaBranchPickerNumber></span> / <span nxaBranchPickerCount></span>
 *   <button nxaBranchPickerNext aria-label="Next">›</button>
 * </div>
 * ```
 */
@Directive({
  selector: '[nxaBranchPickerRoot]',
  host: { '[attr.hidden]': "isHidden() ? '' : null" },
})
export class NxaBranchPickerRoot {
  readonly hideWhenSingleBranch = input(false, { transform: booleanAttribute });

  private readonly branchCount = fromRuntime(injectMessage(), (s) => s.branchCount);
  protected readonly isHidden = computed(
    () => this.hideWhenSingleBranch() && this.branchCount() < 2,
  );
}

/**
 * A button that moves the nearest message to its previous branch. Disabled on the first branch,
 * when the thread does not switch branches, or during a run when the runtime does not switch
 * branches while running. A capture-phase `click` listener can veto the switch with
 * `preventDefault()`.
 */
@Directive({
  selector: 'button[nxaBranchPickerPrevious]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaBranchPickerPrevious {
  /** Disables the button on top of the message state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly message = injectMessage();
  private readonly blocked = branchDisabled(injectThread(), this.message, 'previous');
  protected readonly isDisabled = computed(() => this.disabled() || this.blocked());

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    this.message.switchToBranch({ position: 'previous' });
  }
}

/**
 * A button that moves the nearest message to its next branch. Disabled on the last branch, when
 * the thread does not switch branches, or during a run when the runtime does not switch branches
 * while running. A capture-phase `click` listener can veto the switch with `preventDefault()`.
 */
@Directive({
  selector: 'button[nxaBranchPickerNext]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaBranchPickerNext {
  /** Disables the button on top of the message state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly message = injectMessage();
  private readonly blocked = branchDisabled(injectThread(), this.message, 'next');
  protected readonly isDisabled = computed(() => this.disabled() || this.blocked());

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    this.message.switchToBranch({ position: 'next' });
  }
}

/** Writes the 1-based number of the branch the nearest message shows, as its text. */
@Directive({ selector: '[nxaBranchPickerNumber]', host: { '[textContent]': 'value()' } })
export class NxaBranchPickerNumber {
  protected readonly value = fromRuntime(injectMessage(), (s) => String(s.branchNumber));
}

/** Writes the number of branches of the nearest message, as its text. */
@Directive({ selector: '[nxaBranchPickerCount]', host: { '[textContent]': 'value()' } })
export class NxaBranchPickerCount {
  protected readonly value = fromRuntime(injectMessage(), (s) => String(s.branchCount));
}
