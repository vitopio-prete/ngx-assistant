import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  type CompleteAttachment,
  type PendingAttachment,
} from '@ngx-assistant/engine';

/** Images that keep their file name when sent, so the backend can name them. */
class NamedImageAttachmentAdapter extends SimpleImageAttachmentAdapter {
  override async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const complete = await super.send(attachment);
    return {
      ...complete,
      content: complete.content.map((part) =>
        part.type === 'image' ? { ...part, filename: attachment.name } : part,
      ),
    };
  }
}

/** Images and text files: the attachments the demo backend accepts. */
export const demoAttachments = () =>
  new CompositeAttachmentAdapter([
    new NamedImageAttachmentAdapter(),
    new SimpleTextAttachmentAdapter(),
  ]);
