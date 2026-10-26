import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  NxaBranchPickerCount,
  NxaBranchPickerNext,
  NxaBranchPickerNumber,
  NxaBranchPickerPrevious,
  NxaBranchPickerRoot,
} from '@ngx-assistant/angular';

/** ‹ 1 / 2 › between the branches of the message around it, hidden while it has one. */
@Component({
  selector: 'nxa-demo-branch-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaBranchPickerRoot,
    NxaBranchPickerPrevious,
    NxaBranchPickerNumber,
    NxaBranchPickerCount,
    NxaBranchPickerNext,
  ],
  template: `
    <div nxaBranchPickerRoot hideWhenSingleBranch class="branch-picker">
      <button nxaBranchPickerPrevious class="icon" aria-label="Previous branch">‹</button>
      <span class="branch-label"
        ><span nxaBranchPickerNumber></span> / <span nxaBranchPickerCount></span
      ></span>
      <button nxaBranchPickerNext class="icon" aria-label="Next branch">›</button>
    </div>
  `,
})
export class BranchPicker {}
