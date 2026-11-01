import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  NxaAttachmentRoot,
  NxaAttachmentThumb,
  NxaMessageAttachments,
  NxaMessagePartByIndex,
  NxaMessagePartText,
  NxaMessageParts,
  NxaReasoningGroup,
} from '@ngx-assistant/angular';

/**
 * The attachments and the parts of the message around it: text revealed as it streams, reasoning
 * grouped in a section open while the model thinks, and tool calls, which `*nxaMessageParts`
 * renders with the tool UIs the app declares.
 */
@Component({
  selector: 'nxa-demo-message-content',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaMessageParts,
    NxaMessagePartText,
    NxaMessagePartByIndex,
    NxaReasoningGroup,
    NxaMessageAttachments,
    NxaAttachmentRoot,
    NxaAttachmentThumb,
  ],
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
          <p class="text" nxaMessagePartText></p>
        } @else if (p.type === 'reasoning') {
          <div *nxaReasoningGroup="let group" class="reasoning-group">
            <button
              type="button"
              class="reasoning-toggle"
              [attr.aria-expanded]="group.open()"
              (click)="group.toggle()"
            >
              {{ group.streaming() ? 'Thinking…' : 'Reasoning' }}
            </button>
            @if (group.open()) {
              @for (index of group.indices(); track index) {
                <p *nxaMessagePartByIndex="index" class="reasoning" nxaMessagePartText></p>
              }
            }
          </div>
        }
      </ng-container>
    </div>
  `,
})
export class MessageContent {}
