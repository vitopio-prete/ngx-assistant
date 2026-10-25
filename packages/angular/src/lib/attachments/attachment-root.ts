import { Directive } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectAttachment } from '../scopes';

/**
 * The container of the nearest attachment. It sets `data-nxa-attachment-type` (`image`,
 * `document` or `file`), `data-nxa-attachment-status` (`running`, `requires-action`, `complete`
 * or `incomplete`) and `data-nxa-attachment-source` (`thread-composer`, `edit-composer` or
 * `message`).
 *
 * @example
 * ```html
 * <div *nxaComposerAttachments="let attachment" nxaAttachmentRoot>{{ attachment().name }}</div>
 * ```
 */
@Directive({
  selector: '[nxaAttachmentRoot]',
  host: {
    '[attr.data-nxa-attachment-type]': 'state().type',
    '[attr.data-nxa-attachment-status]': 'state().status.type',
    '[attr.data-nxa-attachment-source]': 'state().source',
  },
})
export class NxaAttachmentRoot {
  protected readonly state = fromRuntime(injectAttachment());
}
