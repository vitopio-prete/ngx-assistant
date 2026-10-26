import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  NxaActionBarCopy,
  NxaActionBarReload,
  NxaActionBarRoot,
  NxaErrorRoot,
  NxaMessageError,
  NxaMessageIf,
  fromRuntime,
  injectMessage,
} from '@ngx-assistant/angular';
import { BranchPicker } from './branch-picker';
import { MessageContent } from './message-content';

/** An assistant reply, with its error, its actions and its branches. */
@Component({
  selector: 'nxa-demo-assistant-message',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaActionBarRoot,
    NxaActionBarCopy,
    NxaActionBarReload,
    NxaMessageError,
    NxaErrorRoot,
    NxaMessageIf,
    BranchPicker,
    MessageContent,
  ],
  template: `
    <nxa-demo-message-content />
    @if (isRunning()) {
      <span class="typing" role="status"
        ><span aria-hidden="true">•••</span><span class="sr-only">Writing</span></span
      >
    }
    <div *nxaMessageError="let error" nxaErrorRoot class="error">{{ error() }}</div>
    <div class="message-footer">
      <nxa-demo-branch-picker />
      <div nxaActionBarRoot autohide="not-last" hideWhenRunning class="action-bar">
        <button nxaActionBarCopy class="action">
          <span *nxaMessageIf="{ copied: true }; else copy">Copied</span>
          <ng-template #copy>Copy</ng-template>
        </button>
        <button nxaActionBarReload class="action">Regenerate</button>
      </div>
    </div>
  `,
})
export class AssistantMessage {
  protected readonly isRunning = fromRuntime(injectMessage(), (s) => s.status?.type === 'running');
}
