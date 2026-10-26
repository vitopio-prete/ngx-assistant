import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  NxaAttachmentRemove,
  NxaAttachmentRoot,
  NxaAttachmentThumb,
  NxaComposerAddAttachment,
  NxaComposerAttachmentDropzone,
  NxaComposerAttachments,
  NxaComposerCancel,
  NxaComposerInput,
  NxaComposerRoot,
  NxaComposerSend,
  NxaThreadIf,
  injectNxaEvent,
} from '@ngx-assistant/angular';

/** The thread composer: text, attachments (picked, pasted or dropped), Send and Stop. */
@Component({
  selector: 'nxa-demo-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaComposerRoot,
    NxaComposerAttachmentDropzone,
    NxaComposerAttachments,
    NxaAttachmentRoot,
    NxaAttachmentThumb,
    NxaAttachmentRemove,
    NxaComposerAddAttachment,
    NxaComposerInput,
    NxaComposerSend,
    NxaComposerCancel,
    NxaThreadIf,
  ],
  template: `
    @if (rejected()) {
      <p role="alert" class="composer-error">{{ rejected() }}</p>
    }
    <form nxaComposerRoot nxaComposerAttachmentDropzone class="composer">
      <div class="attachments">
        <div *nxaComposerAttachments="let attachment" nxaAttachmentRoot class="attachment">
          <span nxaAttachmentThumb #thumb="nxaAttachmentThumb" class="thumb">{{
            thumb.label()
          }}</span>
          <span class="attachment-name">{{ attachment().name }}</span>
          <button nxaAttachmentRemove class="icon" aria-label="Remove attachment">×</button>
        </div>
      </div>
      <div class="composer-row">
        <button nxaComposerAddAttachment class="icon" aria-label="Add attachment">+</button>
        <textarea
          nxaComposerInput
          aria-label="Message"
          placeholder="Write a message, or drop a file here"
          rows="1"
          [autoFocus]="true"
        ></textarea>
        <button *nxaThreadIf="{ running: false }" nxaComposerSend class="primary">Send</button>
        <button *nxaThreadIf="{ running: true }" nxaComposerCancel class="secondary">Stop</button>
      </div>
    </form>
  `,
})
export class Composer {
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
