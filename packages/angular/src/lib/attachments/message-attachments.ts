import { Directive } from '@angular/core';
import { injectMessage } from '../scopes';
import { renderAttachments, type NxaAttachmentsContext } from './attachment-list';

/**
 * Renders its template once per attachment of the nearest message. Only user messages carry
 * attachments; for any other message the list is empty. Each row is an attachment scope, and it
 * follows its attachment like `*nxaComposerAttachments`.
 *
 * @example
 * ```html
 * <div *nxaMessageAttachments="let attachment" nxaAttachmentRoot>
 *   {{ attachment().name }}
 * </div>
 * ```
 */
@Directive({ selector: '[nxaMessageAttachments]' })
export class NxaMessageAttachments {
  // Types the template context; `ctx` is only used in the type predicate.
  static ngTemplateContextGuard(
    _dir: NxaMessageAttachments,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ctx: unknown,
  ): ctx is NxaAttachmentsContext {
    return true;
  }

  constructor() {
    renderAttachments({ kind: 'message', runtime: injectMessage() });
  }
}
