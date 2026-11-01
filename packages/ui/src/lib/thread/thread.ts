import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import {
  NxaComposerIf,
  NxaMessageRoot,
  NxaMessages,
  NxaScrollToBottom,
  NxaThreadEmpty,
  NxaThreadRoot,
  NxaThreadViewport,
  NxaThreadViewportFooter,
} from '@ngx-assistant/angular';
import { NxaIcon } from '../icons';
import { NxaAssistantMessage } from './assistant-message';
import { NxaComposer } from './composer';
import { NxaEditComposer } from './edit-composer';
import { NxaFocusKeeper } from './focus-keeper';
import { NxaThreadWelcome } from './thread-welcome';
import { NxaUserMessage } from './user-message';

/**
 * A complete chat thread on the runtime provided above it: the welcome screen with suggestions
 * while it is empty, the messages (each user message turns into its edit form while edited), a
 * viewport that follows the reply as it streams, a button back to the bottom, and the composer.
 *
 * Fill a container with a height: the thread takes all of it and scrolls inside.
 *
 * @example
 * ```html
 * <nxa-thread class="h-dvh" />
 * ```
 */
@Component({
  selector: 'nxa-thread',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaThreadRoot,
    NxaThreadViewport,
    NxaThreadViewportFooter,
    NxaScrollToBottom,
    NxaThreadEmpty,
    NxaMessages,
    NxaMessageRoot,
    NxaComposerIf,
    NxaFocusKeeper,
    NxaThreadWelcome,
    NxaUserMessage,
    NxaAssistantMessage,
    NxaEditComposer,
    NxaComposer,
    NxaIcon,
  ],
  host: { class: 'flex min-h-0 flex-col bg-nxa-background text-nxa-foreground' },
  template: `
    <div
      nxaThreadRoot
      nxaFocusKeeper
      class="flex min-h-0 flex-1 flex-col [--nxa-thread-max-width:44rem]"
    >
      <div
        nxaThreadViewport
        data-slot="thread-viewport"
        class="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        <div class="mx-auto flex w-full max-w-(--nxa-thread-max-width) flex-1 flex-col px-4 pt-6">
          <nxa-thread-welcome *nxaThreadEmpty [title]="welcome()" />

          <div data-slot="thread-messages" class="mb-6 flex flex-col gap-6 empty:hidden">
            <div
              *nxaMessages="let message"
              nxaMessageRoot
              [attr.data-role]="message().role"
              class="flex flex-col"
            >
              <nxa-edit-composer *nxaComposerIf="{ editing: true }; else view" />
              <ng-template #view>
                @if (message().role === 'user') {
                  <nxa-user-message />
                } @else {
                  <nxa-assistant-message />
                }
              </ng-template>
            </div>
          </div>

          <div
            nxaThreadViewportFooter
            class="sticky bottom-0 mt-auto flex flex-col items-center gap-3 bg-nxa-background pb-4"
          >
            <button
              nxaScrollToBottom
              behavior="smooth"
              aria-label="Scroll to bottom"
              title="Scroll to bottom"
              class="absolute -top-11 flex size-8 items-center justify-center rounded-full border border-nxa-border bg-nxa-background shadow-sm transition-opacity outline-none hover:bg-nxa-accent focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:invisible disabled:opacity-0"
            >
              <nxa-icon name="arrow-down" class="size-4" />
            </button>
            <nxa-composer class="w-full" [autoFocus]="autoFocus()" />
          </div>
        </div>
      </div>
    </div>
  `,
})
export class NxaThread {
  /** Whether the composer takes the focus (on by default, as a chat page expects). */
  readonly autoFocus = input(true, { transform: booleanAttribute });
  /** The greeting of the empty thread. */
  readonly welcome = input('How can I help you today?');
}
