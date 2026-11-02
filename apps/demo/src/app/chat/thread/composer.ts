import { ChangeDetectionStrategy, Component, booleanAttribute, input, signal } from '@angular/core';
import {
  NxaComposerAddAttachment,
  NxaComposerAttachmentDropzone,
  NxaComposerAttachments,
  NxaComposerCancel,
  NxaComposerInput,
  NxaComposerRoot,
  NxaComposerSend,
  NxaThreadIf,
  fromRuntime,
  injectNxaEvent,
  injectThread,
} from '@ngx-assistant/angular';
import { NxaIcon } from '../icons';
import { NxaAttachment } from './attachment';

const ROUND =
  'flex size-8 items-center justify-center rounded-full outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:opacity-40';

/**
 * The thread composer: attachments picked, pasted or dropped, the message field (Enter sends,
 * Shift+Enter adds a line) and Send, which turns into Stop while a run goes on. With `autoFocus`
 * the field takes the focus when it appears, when a run starts, when the thread changes and after
 * scrolling to the bottom.
 */
@Component({
  selector: 'nxa-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaComposerRoot,
    NxaComposerAttachmentDropzone,
    NxaComposerAttachments,
    NxaComposerAddAttachment,
    NxaComposerInput,
    NxaComposerSend,
    NxaComposerCancel,
    NxaThreadIf,
    NxaAttachment,
    NxaIcon,
  ],
  host: { class: 'flex flex-col gap-2', 'data-slot': 'composer' },
  template: `
    @if (rejected(); as message) {
      <p role="alert" class="px-2 text-sm text-nxa-destructive">{{ message }}</p>
    }
    <form
      nxaComposerRoot
      nxaComposerAttachmentDropzone
      class="flex w-full cursor-text flex-col gap-2 rounded-2xl border border-nxa-border bg-nxa-background p-2 shadow-sm transition-colors focus-within:border-nxa-ring data-[nxa-dragging]:border-dashed data-[nxa-dragging]:border-nxa-ring data-[nxa-dragging]:bg-nxa-accent"
    >
      <div data-slot="composer-attachments" class="flex flex-wrap gap-2 px-1 pt-1 empty:hidden">
        <nxa-attachment *nxaComposerAttachments removable />
      </div>
      <textarea
        nxaComposerInput
        aria-label="Message"
        [placeholder]="placeholder()"
        rows="1"
        enterkeyhint="send"
        [autoFocus]="autoFocus()"
        class="max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1.5 text-base leading-6 outline-none [field-sizing:content] placeholder:text-nxa-muted-foreground"
      ></textarea>
      <div class="flex items-center justify-between">
        <div class="flex items-center">
          @if (canAttach()) {
            <button
              nxaComposerAddAttachment
              [class]="
                round + ' text-nxa-muted-foreground hover:bg-nxa-accent hover:text-nxa-foreground'
              "
              aria-label="Add attachment"
              title="Add attachment"
            >
              <nxa-icon name="paperclip" class="size-4" />
            </button>
          }
        </div>
        <button
          *nxaThreadIf="{ running: false }"
          nxaComposerSend
          [class]="round + ' bg-nxa-primary text-nxa-primary-foreground'"
          aria-label="Send"
          title="Send"
        >
          <nxa-icon name="arrow-up" class="size-4" />
        </button>
        <button
          *nxaThreadIf="{ running: true }"
          nxaComposerCancel
          [class]="round + ' bg-nxa-primary text-nxa-primary-foreground'"
          aria-label="Stop"
          title="Stop"
        >
          <nxa-icon name="stop" [filled]="true" class="size-3.5" />
        </button>
      </div>
    </form>
  `,
})
export class NxaComposer {
  /** Whether the field takes the focus (see the class description). */
  readonly autoFocus = input(true, { transform: booleanAttribute });
  readonly placeholder = input('Send a message…');

  protected readonly round = ROUND;
  protected readonly canAttach = fromRuntime(injectThread(), (s) => s.capabilities.attachments);
  /** Why the last file was not attached, until a file is attached or the message is sent. */
  protected readonly rejected = signal('');

  constructor() {
    injectNxaEvent('composer.attachmentAddError', ({ message }) =>
      this.rejected.set(`The file was not attached: ${message}`),
    );
    injectNxaEvent('composer.attachmentAdd', () => this.rejected.set(''));
    injectNxaEvent('composer.send', () => this.rejected.set(''));
  }
}
