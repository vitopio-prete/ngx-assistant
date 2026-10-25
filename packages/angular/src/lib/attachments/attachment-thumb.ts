import { Directive } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectAttachment } from '../scopes';

/**
 * A short label for an attachment: its extension with the dot (`.png`, `.gz` for
 * `archive.tar.gz`) when the name has one, otherwise its type. A name that starts or ends with
 * the only dot (`.gitignore`, `report.`) has no extension.
 */
export function getAttachmentLabel(attachment: { readonly name: string; readonly type: string }) {
  const { name } = attachment;
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? `.${name.slice(dot + 1)}` : attachment.type;
}

/**
 * Gives the nearest attachment's short label (see `getAttachmentLabel`) as `label()`, for a
 * thumbnail placeholder. It renders nothing itself.
 *
 * @example
 * ```html
 * <div nxaAttachmentThumb #thumb="nxaAttachmentThumb">{{ thumb.label() }}</div>
 * ```
 */
@Directive({ selector: '[nxaAttachmentThumb]', exportAs: 'nxaAttachmentThumb' })
export class NxaAttachmentThumb {
  /** The attachment's extension, or its type. */
  readonly label = fromRuntime(injectAttachment(), getAttachmentLabel);
}
