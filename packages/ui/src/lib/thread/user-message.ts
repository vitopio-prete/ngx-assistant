import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  NxaActionBarCopy,
  NxaActionBarEdit,
  NxaActionBarRoot,
  NxaMessageAttachments,
  NxaMessageIf,
  NxaMessageParts,
} from '@ngx-assistant/angular';
import { NxaIcon } from '../icons';
import { ACTION_BAR, ACTION_BUTTON } from './action-button';
import { NxaAttachment } from './attachment';
import { NxaBranchPicker } from './branch-picker';
import { NxaMessageFile } from './message-file';

/**
 * A user message: its attachments, its text as typed (never as markdown) in a bubble with the Edit
 * and Copy actions beside it, which show on hover or keyboard focus, and the branch picker below.
 */
@Component({
  selector: 'nxa-user-message',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaMessageAttachments,
    NxaMessageParts,
    NxaMessageIf,
    NxaActionBarRoot,
    NxaActionBarEdit,
    NxaActionBarCopy,
    NxaAttachment,
    NxaBranchPicker,
    NxaMessageFile,
    NxaIcon,
  ],
  host: { class: 'flex flex-col items-end gap-1.5', 'data-slot': 'user-message' },
  template: `
    <div data-slot="user-message-attachments" class="flex flex-wrap justify-end gap-2 empty:hidden">
      <nxa-attachment *nxaMessageAttachments />
    </div>
    <div class="flex w-full items-center justify-end gap-1">
      <div nxaActionBarRoot hideWhenRunning autohide="not-last" [class]="actionBar">
        <button nxaActionBarEdit [class]="button" aria-label="Edit" title="Edit">
          <nxa-icon name="pencil" class="size-3.5" />
        </button>
        <button nxaActionBarCopy [class]="button" aria-label="Copy" title="Copy">
          <nxa-icon *nxaMessageIf="{ copied: true }; else copy" name="check" class="size-3.5" />
          <ng-template #copy><nxa-icon name="copy" class="size-3.5" /></ng-template>
        </button>
      </div>
      <div
        data-slot="user-message-content"
        class="max-w-[85%] rounded-2xl bg-nxa-muted px-4 py-2 break-words whitespace-pre-wrap empty:hidden"
      >
        <ng-container *nxaMessageParts="let part">
          @let p = part();
          @if (p.type === 'text') {
            <span>{{ p.text }}</span>
          } @else if (p.type === 'image' || p.type === 'file') {
            <nxa-message-file [part]="p" class="my-1" />
          }
        </ng-container>
      </div>
    </div>
    <nxa-branch-picker />
  `,
})
export class NxaUserMessage {
  protected readonly button = ACTION_BUTTON;
  protected readonly actionBar = ACTION_BAR;
}
