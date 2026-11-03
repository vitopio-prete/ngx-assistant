import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import {
  NxaActionBarCopy,
  NxaActionBarExportMarkdown,
  NxaActionBarFeedbackNegative,
  NxaActionBarFeedbackPositive,
  NxaActionBarReload,
  NxaActionBarRoot,
  NxaActionBarSpeak,
  NxaActionBarStopSpeaking,
  NxaMessageIf,
  NxaMessageParts,
  fromRuntime,
  injectMessage,
  injectThread,
} from '@ngx-assistant/angular';
import { NxaIcon } from '../icons';
import { MENU_BELOW, MENU_ITEM, MENU_PANEL } from '../menu/menu';
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
 * branch picker and the actions: Copy, Helpful / Not helpful (when the runtime has a feedback
 * adapter), Regenerate, and a More menu with Export as Markdown and Read aloud (when the runtime
 * has a speech adapter).
 */
@Component({
  selector: 'nxa-assistant-message',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaMessageParts,
    NxaMessageIf,
    NxaActionBarRoot,
    NxaActionBarCopy,
    NxaActionBarFeedbackPositive,
    NxaActionBarFeedbackNegative,
    NxaActionBarReload,
    NxaActionBarExportMarkdown,
    NxaActionBarSpeak,
    NxaActionBarStopSpeaking,
    CdkMenuTrigger,
    CdkMenu,
    CdkMenuItem,
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
        @if (canFeedback()) {
          <button
            nxaActionBarFeedbackPositive
            [class]="toggle"
            aria-label="Helpful"
            title="Helpful"
          >
            <nxa-icon name="thumbs-up" class="size-3.5" />
          </button>
          <button
            nxaActionBarFeedbackNegative
            [class]="toggle"
            aria-label="Not helpful"
            title="Not helpful"
          >
            <nxa-icon name="thumbs-down" class="size-3.5" />
          </button>
        }
        <button nxaActionBarReload [class]="button" aria-label="Regenerate" title="Regenerate">
          <nxa-icon name="refresh" class="size-3.5" />
        </button>
        <!-- Export and Read aloud need text: a menu of disabled items could not take the focus. -->
        @if (hasText()) {
          <button
            type="button"
            [cdkMenuTriggerFor]="more"
            [cdkMenuPosition]="below"
            [class]="button"
            aria-label="More actions"
            title="More actions"
            data-slot="assistant-message-more"
          >
            <nxa-icon name="more" class="size-3.5" />
          </button>
        }
      </div>
      <ng-template #more>
        <div cdkMenu data-slot="assistant-message-menu" [class]="panel">
          <button
            cdkMenuItem
            nxaActionBarExportMarkdown
            data-slot="assistant-message-menu-item"
            [class]="item"
          >
            <nxa-icon name="download" class="size-4" />
            Export as Markdown
          </button>
          @if (canSpeak()) {
            <button
              *nxaMessageIf="{ speaking: false }; else stop"
              cdkMenuItem
              nxaActionBarSpeak
              data-slot="assistant-message-menu-item"
              [class]="item"
            >
              <nxa-icon name="volume" class="size-4" />
              Read aloud
            </button>
            <ng-template #stop>
              <button
                cdkMenuItem
                nxaActionBarStopSpeaking
                data-slot="assistant-message-menu-item"
                [class]="item"
              >
                <nxa-icon name="stop" class="size-4" />
                Stop reading
              </button>
            </ng-template>
          }
        </div>
      </ng-template>
    </div>
  `,
})
export class NxaAssistantMessage {
  protected readonly button = ACTION_BUTTON;
  protected readonly toggle = `${ACTION_BUTTON} aria-pressed:bg-nxa-accent aria-pressed:text-nxa-foreground`;
  protected readonly actionBar = ACTION_BAR;
  protected readonly panel = MENU_PANEL;
  protected readonly item = MENU_ITEM;
  protected readonly below = MENU_BELOW;
  private readonly capabilities = fromRuntime(injectThread(), (s) => s.capabilities);
  /** The runtime records feedback: show Helpful and Not helpful. */
  protected readonly canFeedback = computed(() => this.capabilities().feedback);
  /** The runtime reads aloud: offer it in the More menu. */
  protected readonly canSpeak = computed(() => this.capabilities().speech);
  /** The reply has text to export or read aloud. */
  protected readonly hasText = fromRuntime(injectMessage(), (s) =>
    s.content.some((part) => part.type === 'text' && part.text.trim() !== ''),
  );
  /** The reply has started but has no content yet. */
  protected readonly waiting = fromRuntime(
    injectMessage(),
    (s) => s.status?.type === 'running' && s.content.length === 0,
  );
}
