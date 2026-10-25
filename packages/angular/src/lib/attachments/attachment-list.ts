import { DestroyRef, Injector, TemplateRef, ViewContainerRef, effect, inject } from '@angular/core';
import type { AttachmentRuntime, AttachmentRuntimeState } from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';
import { KeyedViews, type NxaRowContext } from '../messages/keyed-views';
import { provideAttachmentScope } from '../scopes';
import { attachmentRows, ownerAttachments, type AttachmentOwner } from './attachment-row';

/** The template context of an attachment list: `let attachment` is a `Signal` of its state. */
export type NxaAttachmentsContext = NxaRowContext<AttachmentRuntimeState>;

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/** Renders the template once per attachment of `owner`, each row an attachment scope. */
export function renderAttachments(owner: AttachmentOwner) {
  const views = new KeyedViews<AttachmentRuntimeState, AttachmentRuntime>(
    inject(ViewContainerRef),
    inject(TemplateRef<NxaAttachmentsContext>),
    inject(Injector),
    provideAttachmentScope,
  );
  // Rows only change with the ids; a row reads its own state.
  const ids = fromRuntime<unknown, string[]>(
    owner.runtime,
    () => ownerAttachments(owner).map((attachment) => attachment.id),
    { equal: sameIds },
  );
  effect(() => {
    ids();
    views.update(attachmentRows(owner, ownerAttachments(owner)));
  });
  inject(DestroyRef).onDestroy(() => views.clear());
}
