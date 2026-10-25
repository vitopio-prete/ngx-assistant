import { Directive } from '@angular/core';
import { injectComposer } from '../scopes';
import { renderAttachments, type NxaAttachmentsContext } from './attachment-list';

/**
 * Renders its template once per attachment of the nearest composer: the thread composer, or the
 * edit composer inside a message. Each row is an attachment scope: inside it `injectAttachment()`
 * is the row's attachment.
 *
 * A row follows its attachment, so removing an attachment before it keeps the row and its state.
 * The context gives `let attachment` (a `Signal` of the attachment state), `index`, `count`,
 * `first` and `last`.
 *
 * @example
 * ```html
 * <div *nxaComposerAttachments="let attachment" nxaAttachmentRoot>
 *   {{ attachment().name }}
 *   <button nxaAttachmentRemove>Remove</button>
 * </div>
 * ```
 */
@Directive({ selector: '[nxaComposerAttachments]' })
export class NxaComposerAttachments {
  // Types the template context; `ctx` is only used in the type predicate.
  static ngTemplateContextGuard(
    _dir: NxaComposerAttachments,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ctx: unknown,
  ): ctx is NxaAttachmentsContext {
    return true;
  }

  constructor() {
    renderAttachments({ kind: 'composer', runtime: injectComposer() });
  }
}
