import { Directive, input } from '@angular/core';
import { injectSmoothText, type NxaSmooth, type NxaSmoothOptions } from './smooth-text';

// Like a missing input, `undefined` keeps the default (on); `null` turns it off.
const toSmooth = (value: NxaSmooth | '' | 'true' | 'false'): boolean | NxaSmoothOptions =>
  value === undefined || value === '' || value === 'true'
    ? true
    : value === 'false' || value === null
      ? false
      : value;

/**
 * Shows the text of the nearest `text` or `reasoning` part as the element's text content, which
 * replaces whatever the element holds. While the part streams the text is revealed smoothly
 * (`smooth`, on by default; `false` turns it off, an {@link NxaSmoothOptions} object tunes it; off
 * under `prefers-reduced-motion: reduce`), as {@link injectSmoothText} describes.
 * `data-nxa-status` is `running` until the text is shown in full, then the status of the part.
 *
 * @example
 * ```html
 * <ng-container *nxaMessageParts="let part">
 *   @if (part().type === 'text') { <p nxaMessagePartText></p> }
 * </ng-container>
 * ```
 */
@Directive({
  selector: '[nxaMessagePartText]',
  exportAs: 'nxaMessagePartText',
  host: {
    '[textContent]': 'state().text',
    '[attr.data-nxa-status]': 'state().status.type',
  },
})
export class NxaMessagePartText {
  readonly smooth = input<boolean | NxaSmoothOptions, NxaSmooth | '' | 'true' | 'false'>(true, {
    transform: toSmooth,
  });

  /** The text shown and its status. */
  readonly state = injectSmoothText(() => this.smooth());
}
