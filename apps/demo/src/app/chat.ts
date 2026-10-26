import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
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
  injectNxaEvent,
  injectThread,
  provideLocalRuntime,
  provideSuggestions,
} from '@ngx-assistant/angular';
import { AssistantMessage } from './assistant-message';
import { Composer } from './composer';
import { FAIL_COMMAND, demoAttachments, echoModel } from './echo-model';
import { ThreadStore } from './thread-store';
import { UserMessage } from './user-message';

const TITLE_LENGTH = 40;

/** One conversation, on its own local runtime. */
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
    provideLocalRuntime(echoModel, () => ({ adapters: { attachments: demoAttachments() } })),
    provideSuggestions([
      { title: 'Say hello', label: 'a first message', prompt: 'Hello there!' },
      { title: 'Show an error', label: 'a reply that fails', prompt: `${FAIL_COMMAND} please` },
    ]),
  ],
  template: `
    <section nxaThreadRoot class="thread">
      <div nxaThreadViewport class="viewport">
        <div *nxaThreadEmpty class="welcome">
          <h2>How can I help?</h2>
          <p>
            The echo model repeats your message word by word. Edit a message or regenerate a reply
            to create branches, attach images or text files, or include /error to see a failed
            reply.
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
  readonly threadId = input.required<string>();

  constructor() {
    const store = inject(ThreadStore);
    const thread = injectThread();
    const host: HTMLElement = inject(ElementRef).nativeElement;

    // The composer follows the switches of the outer thread list, which its own runtime never sees.
    let shown = false;
    afterRenderEffect(() => {
      const isShown = store.mainId() === this.threadId();
      if (isShown && !shown) host.querySelector<HTMLElement>('[aria-label="Message"]')?.focus();
      shown = isShown;
    });

    // The first run names the conversation after its first message.
    injectNxaEvent('thread.runStart', () => {
      const id = this.threadId();
      if (store.threads().find((t) => t.id === id)?.title) return;
      const first = thread.getState().messages.find((m) => m.role === 'user');
      const text = first?.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
      const title = text?.trim() || first?.attachments.at(0)?.name;
      if (title) store.rename(id, title.slice(0, TITLE_LENGTH));
    });
  }
}
