import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  NxaActionBarCopy,
  NxaActionBarEdit,
  NxaActionBarRoot,
  NxaComposerCancel,
  NxaComposerIf,
  NxaComposerInput,
  NxaComposerRoot,
  NxaComposerSend,
  NxaMessageIf,
} from '@ngx-assistant/angular';
import { BranchPicker } from './branch-picker';
import { MessageContent } from './message-content';

/** A user message, which turns into its edit form while it is being edited. */
@Component({
  selector: 'nxa-demo-user-message',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaComposerIf,
    NxaComposerRoot,
    NxaComposerInput,
    NxaComposerCancel,
    NxaComposerSend,
    NxaActionBarRoot,
    NxaActionBarEdit,
    NxaActionBarCopy,
    NxaMessageIf,
    BranchPicker,
    MessageContent,
  ],
  template: `
    <form *nxaComposerIf="{ editing: true }; else view" nxaComposerRoot class="edit-composer">
      <textarea nxaComposerInput aria-label="Edit message" [autoFocus]="true"></textarea>
      <div class="edit-actions">
        <button nxaComposerCancel class="secondary">Cancel</button>
        <button nxaComposerSend class="primary">Save</button>
      </div>
    </form>
    <ng-template #view>
      <nxa-demo-message-content />
      <div class="message-footer">
        <nxa-demo-branch-picker />
        <div nxaActionBarRoot class="action-bar">
          <button nxaActionBarEdit class="action">Edit</button>
          <button nxaActionBarCopy class="action">
            <span *nxaMessageIf="{ copied: true }; else copy">Copied</span>
            <ng-template #copy>Copy</ng-template>
          </button>
        </div>
      </div>
    </ng-template>
  `,
})
export class UserMessage {}
