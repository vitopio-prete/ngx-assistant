import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  inject,
} from '@angular/core';
import {
  NxaMessageRoot,
  NxaMessages,
  NxaScrollToBottom,
  NxaSuggestionDescription,
  NxaSuggestions,
  NxaSuggestionTitle,
  NxaSuggestionTrigger,
  NxaThreadEmpty,
  NxaThreadRoot,
  NxaThreadViewport,
  NxaThreadViewportFooter,
  fromRuntime,
  injectAssistant,
  provideSuggestions,
} from '@ngx-assistant/angular';
import { AssistantMessage } from './assistant-message';
import { Composer } from './composer';
import { UserMessage } from './user-message';

/** The conversation shown, whichever runtime of the thread list it runs on. */
@Component({
  selector: 'nxa-demo-chat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'chat' },
  imports: [
    NxaThreadRoot,
    NxaThreadViewport,
    NxaThreadViewportFooter,
    NxaScrollToBottom,
    NxaThreadEmpty,
    NxaSuggestions,
    NxaSuggestionTrigger,
    NxaSuggestionTitle,
    NxaSuggestionDescription,
    NxaMessages,
    NxaMessageRoot,
    UserMessage,
    AssistantMessage,
    Composer,
  ],
  providers: [
    provideSuggestions([
      { title: 'Say hello', label: 'a first message', prompt: 'Hello there!' },
      { title: 'Check the weather', label: 'a tool the backend runs', prompt: 'weather in Rome' },
      {
        title: 'Send an email',
        label: 'a tool you approve',
        prompt: 'send an email to ada@example.com',
      },
      { title: 'Show an error', label: 'a request that fails', prompt: '/error please' },
    ]),
  ],
  template: `
    <section nxaThreadRoot class="thread">
      <div nxaThreadViewport class="viewport">
        <div *nxaThreadEmpty class="welcome">
          <h2>How can I help?</h2>
          <p>
            The backend echoes your message word by word, checks the weather in a city, or asks
            before sending an email. Edit a message or regenerate a reply to create branches, attach
            images or text files, or include /error or /error-stream to see a failure.
          </p>
          <div class="suggestions">
            <button *nxaSuggestions nxaSuggestionTrigger send class="suggestion">
              <strong nxaSuggestionTitle></strong>
              <span nxaSuggestionDescription></span>
            </button>
          </div>
        </div>

        <article
          *nxaMessages="let message"
          nxaMessageRoot
          class="message"
          [attr.data-role]="message().role"
        >
          @if (message().role === 'user') {
            <nxa-demo-user-message />
          } @else {
            <nxa-demo-assistant-message />
          }
        </article>

        <div nxaThreadViewportFooter class="footer">
          <button nxaScrollToBottom class="scroll-to-bottom" aria-label="Scroll to bottom">
            ↓
          </button>
          <nxa-demo-composer />
        </div>
      </div>
    </section>
  `,
})
export class Chat {
  constructor() {
    const threadId = fromRuntime(injectAssistant().threads, (s) => s.mainThreadId);
    const host: HTMLElement = inject(ElementRef).nativeElement;

    // Switching conversations puts the focus back in the composer.
    let shown: string | undefined;
    afterRenderEffect(() => {
      const id = threadId();
      if (shown !== undefined && id !== shown) {
        host.querySelector<HTMLElement>('[aria-label="Message"]')?.focus();
      }
      shown = id;
    });
  }
}
