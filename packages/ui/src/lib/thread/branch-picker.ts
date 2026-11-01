import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  NxaBranchPickerCount,
  NxaBranchPickerNext,
  NxaBranchPickerNumber,
  NxaBranchPickerPrevious,
  NxaBranchPickerRoot,
} from '@ngx-assistant/angular';
import { NxaIcon } from '../icons';

const ARROW =
  'flex size-6 items-center justify-center rounded-md outline-none hover:bg-nxa-accent hover:text-nxa-foreground focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:pointer-events-none disabled:opacity-40';

/** `‹ 2 / 3 ›` between the branches of the nearest message; hidden while it has one branch. */
@Component({
  selector: 'nxa-branch-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaBranchPickerRoot,
    NxaBranchPickerPrevious,
    NxaBranchPickerNumber,
    NxaBranchPickerCount,
    NxaBranchPickerNext,
    NxaIcon,
  ],
  host: { class: 'contents' },
  template: `
    <div
      nxaBranchPickerRoot
      hideWhenSingleBranch
      data-slot="branch-picker"
      class="inline-flex items-center gap-0.5 text-xs text-nxa-muted-foreground"
    >
      <button nxaBranchPickerPrevious [class]="arrow" aria-label="Previous branch" title="Previous">
        <nxa-icon name="chevron-left" class="size-3.5" />
      </button>
      <span class="tabular-nums"
        ><span nxaBranchPickerNumber></span> / <span nxaBranchPickerCount></span
      ></span>
      <button nxaBranchPickerNext [class]="arrow" aria-label="Next branch" title="Next">
        <nxa-icon name="chevron-right" class="size-3.5" />
      </button>
    </div>
  `,
})
export class NxaBranchPicker {
  protected readonly arrow = ARROW;
}
