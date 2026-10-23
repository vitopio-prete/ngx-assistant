import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { AssistantRuntimeImpl, LocalRuntimeCore } from '@ngx-assistant/engine';
import { echoModel } from './echo-model';
import { fromRuntime, injectAssistantRuntime, provideAssistantRuntime } from './runtime';

const createRuntime = () =>
  new AssistantRuntimeImpl(new LocalRuntimeCore({ adapters: { chatModel: echoModel } }, []));

@Component({
  selector: 'nxa-demo-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [provideAssistantRuntime(createRuntime)],
  template: `
    <h1>ngx-assistant demo</h1>
    <ul id="messages">
      @for (message of messages(); track message.id) {
        <li [attr.data-role]="message.role">
          <b>{{ message.role }}:</b>
          @for (part of message.content; track $index) {
            @if (part.type === 'text') {
              <span>{{ part.text }}</span>
            }
          }
        </li>
      }
    </ul>
    <textarea
      id="input"
      aria-label="Message"
      [value]="text()"
      (input)="setText($event)"
      (keydown)="onKeydown($event)"
    ></textarea>
    <button id="send" type="button" [disabled]="sendDisabled()" (click)="send()">Send</button>
    <button id="cancel" type="button" [disabled]="!isRunning()" (click)="cancel()">Stop</button>
    <p id="status">{{ isRunning() ? 'running' : 'idle' }}</p>
  `,
})
export class App {
  private readonly thread = injectAssistantRuntime().thread;
  protected readonly messages = fromRuntime(this.thread, (s) => s.messages);
  protected readonly isRunning = fromRuntime(this.thread, (s) => s.isRunning);
  protected readonly text = fromRuntime(this.thread.composer, (s) => s.text);
  private readonly canSend = fromRuntime(this.thread.composer, (s) => s.canSend);
  private readonly canQueue = fromRuntime(this.thread, (s) => s.capabilities.queue);
  // Without a queue, a send during a run would start a second run: block it until the run ends.
  protected readonly sendDisabled = computed(
    () => !this.canSend() || (this.isRunning() && !this.canQueue()),
  );

  protected setText(event: Event) {
    this.thread.composer.setText((event.target as HTMLTextAreaElement).value);
  }

  protected onKeydown(event: KeyboardEvent) {
    // Shift+Enter inserts a newline; Enter while an IME is composing confirms the composition.
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    // While sending is blocked, Enter keeps its default behavior instead of being swallowed.
    if (this.sendDisabled()) return;
    event.preventDefault();
    this.send();
  }

  protected send() {
    if (this.sendDisabled()) return;
    this.thread.composer.send();
  }

  protected cancel() {
    this.thread.cancelRun();
  }
}
