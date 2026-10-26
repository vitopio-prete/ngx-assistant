import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  NxaAttachmentRoot,
  NxaAttachmentThumb,
  NxaMessageAttachments,
  NxaMessageParts,
} from '@ngx-assistant/angular';

/** The text parts and the attachments of the message around it. */
@Component({
  selector: 'nxa-demo-message-content',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaMessageParts, NxaMessageAttachments, NxaAttachmentRoot, NxaAttachmentThumb],
  template: `
    <div class="attachments">
      <div *nxaMessageAttachments="let attachment" nxaAttachmentRoot class="attachment">
        <span nxaAttachmentThumb #thumb="nxaAttachmentThumb" class="thumb">{{
          thumb.label()
        }}</span>
        <span class="attachment-name">{{ attachment().name }}</span>
      </div>
    </div>
    <div class="bubble">
      <ng-container *nxaMessageParts="let part">
        @let p = part();
        @if (p.type === 'text') {
          <p class="text">{{ p.text }}</p>
        }
      </ng-container>
    </div>
  `,
})
export class MessageContent {}
