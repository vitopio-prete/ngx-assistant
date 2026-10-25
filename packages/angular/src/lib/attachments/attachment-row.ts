import type {
  Attachment,
  AttachmentRuntime,
  AttachmentRuntimeState,
  ComposerRuntime,
  MessageRuntime,
} from '@ngx-assistant/engine';
import type { KeyedRow } from '../messages/keyed-views';

/** What lists attachments and hands out a runtime per index: a composer or a message. */
export type AttachmentOwner =
  | { readonly kind: 'composer'; readonly runtime: ComposerRuntime }
  | { readonly kind: 'message'; readonly runtime: MessageRuntime };

/** The attachments a list renders: the composer's draft, or the attachments of a user message. */
export function ownerAttachments(owner: AttachmentOwner): readonly Attachment[] {
  if (owner.kind === 'composer') return owner.runtime.getState().attachments;
  const state = owner.runtime.getState();
  return state.role === 'user' ? (state.attachments ?? []) : [];
}

/**
 * The keys of a list of attachments: an attachment whose id is unique in the list is keyed by its
 * id, so its row follows it; a duplicated id is keyed by its position.
 */
export function getAttachmentKeys(attachments: readonly { readonly id: string }[]): string[] {
  const ids = attachments.map((attachment) => attachment.id);
  return ids.map((id, index) =>
    ids.indexOf(id) === ids.lastIndexOf(id) ? `attachment:${id}` : `attachment@${index}`,
  );
}

const shallowEqual = (a: object, b: object) => {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
};

/**
 * An attachment runtime that finds its attachment on every read: by id when `id` is given,
 * otherwise at `index`. The engine hands out attachments only by index, so a runtime bound to an
 * index would show the next attachment once one before it is removed. While the attachment is
 * gone, the state stays the last one read.
 */
class AttachmentRowRuntime implements AttachmentRuntime {
  private cached: { index: number; runtime: AttachmentRuntime } | undefined;
  private last: AttachmentRuntimeState;

  constructor(
    private readonly owner: AttachmentOwner,
    private readonly id: string | undefined,
    private readonly fixedIndex: number,
  ) {
    this.last = this.runtimeAt(this.currentIndex()).getState();
    this.getState = this.getState.bind(this);
    this.remove = this.remove.bind(this);
    this.subscribe = this.subscribe.bind(this);
  }

  get path() {
    return this.current().path;
  }

  get source() {
    return this.last.source;
  }

  getState(): AttachmentRuntimeState {
    const index = this.currentIndex();
    if (index === -1) return this.last;
    const state = this.runtimeAt(index).getState();
    if (state !== this.last && !shallowEqual(state, this.last)) this.last = state;
    return this.last;
  }

  async remove(): Promise<void> {
    const index = this.currentIndex();
    if (index === -1) throw new Error('[ngx-assistant] The attachment is no longer available.');
    await this.runtimeAt(index).remove();
  }

  subscribe(callback: () => void) {
    return this.owner.runtime.subscribe(callback);
  }

  private currentIndex() {
    const attachments = ownerAttachments(this.owner);
    if (this.id === undefined) return this.fixedIndex < attachments.length ? this.fixedIndex : -1;
    return attachments.findIndex((attachment) => attachment.id === this.id);
  }

  private current() {
    const index = this.currentIndex();
    return this.runtimeAt(index === -1 ? (this.cached?.index ?? this.fixedIndex) : index);
  }

  private runtimeAt(index: number): AttachmentRuntime {
    if (this.cached?.index !== index) {
      this.cached = { index, runtime: this.owner.runtime.getAttachmentByIndex(index) };
    }
    return this.cached.runtime;
  }
}

/** The rows of an attachment list, each with a runtime that follows its attachment. */
export function attachmentRows(
  owner: AttachmentOwner,
  attachments: readonly Attachment[],
): KeyedRow<AttachmentRuntime>[] {
  const keys = getAttachmentKeys(attachments);
  return attachments.map((attachment, index) => {
    const key = keys[index]!;
    const id = key.startsWith('attachment:') ? attachment.id : undefined;
    return { key, create: () => new AttachmentRowRuntime(owner, id, index) };
  });
}
