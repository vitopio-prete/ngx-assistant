import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  NxaActionBarCopy,
  NxaActionBarReload,
  NxaActionBarRoot,
  NxaMessageIf,
  NxaMessageParts,
  fromRuntime,
  injectMessage,
} from '@ngx-assistant/angular';
import { NxaIcon } from '../icons';
import { ACTION_BAR, ACTION_BUTTON } from './action-button';
import { NxaBranchPicker } from './branch-picker';
import { NxaMarkdownText } from './markdown-text';
import { NxaMessageErrorNotice } from './message-error';
import { NxaMessageFile } from './message-file';
import { NxaReasoning } from './reasoning';
import { NxaToolFallback } from './tool-fallback';

/**
 * An assistant reply: text as markdown, reasoning in a disclosure, tool calls with the UI the app
 * registers (`provideToolUi`) or the fallback, files, the error of a failed run, and below it the
 * branch picker and the Copy and Regenerate actions.
 */
@Component({
  selector: 'nxa-assistant-message',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaMessageParts,
    NxaMessageIf,
    NxaActionBarRoot,
    NxaActionBarCopy,
    NxaActionBarReload,
    NxaBranchPicker,
    NxaMarkdownText,
    NxaReasoning,
    NxaToolFallback,
    NxaMessageFile,
    NxaMessageErrorNotice,
    NxaIcon,
  ],
  host: { class: 'flex flex-col gap-1', 'data-slot': 'assistant-message' },
  template: `
    <div data-slot="assistant-message-content" class="px-1 leading-relaxed break-words">
      <ng-container *nxaMessageParts="let part">
        @let p = part();
        @switch (p.type) {
          @case ('text') {
            <nxa-markdown-text class="my-1" />
          }
          @case ('reasoning') {
            <nxa-reasoning />
          }
          @case ('tool-call') {
            <nxa-tool-fallback class="my-1" />
          }
          @case ('image') {
            <nxa-message-file [part]="p" class="my-2" />
          }
          @case ('file') {
            <nxa-message-file [part]="p" class="my-2" />
          }
        }
      </ng-container>
      @if (waiting()) {
        <span role="status" class="inline-flex items-center gap-1 py-2">
          <span class="size-1.5 animate-pulse rounded-full bg-nxa-muted-foreground"></span>
          <span
            class="size-1.5 animate-pulse rounded-full bg-nxa-muted-foreground [animation-delay:150ms]"
          ></span>
          <span
            class="size-1.5 animate-pulse rounded-full bg-nxa-muted-foreground [animation-delay:300ms]"
          ></span>
          <span class="sr-only">Writing</span>
        </span>
      }
      <nxa-message-error />
    </div>
    <div class="flex min-h-7 items-center gap-1">
      <nxa-branch-picker />
      <div nxaActionBarRoot hideWhenRunning autohide="not-last" [class]="actionBar">
        <button nxaActionBarCopy [class]="button" aria-label="Copy" title="Copy">
          <nxa-icon *nxaMessageIf="{ copied: true }; else copy" name="check" class="size-3.5" />
          <ng-template #copy><nxa-icon name="copy" class="size-3.5" /></ng-template>
        </button>
        <button nxaActionBarReload [class]="button" aria-label="Regenerate" title="Regenerate">
          <nxa-icon name="refresh" class="size-3.5" />
        </button>
      </div>
    </div>
  `,
})
export class NxaAssistantMessage {
  protected readonly button = ACTION_BUTTON;
  protected readonly actionBar = ACTION_BAR;
  /** The reply has started but has no content yet. */
  protected readonly waiting = fromRuntime(
    injectMessage(),
    (s) => s.status?.type === 'running' && s.content.length === 0,
  );
}
