import { Directive } from '@angular/core';

/**
 * The container of an error. It has `role="alert"`, so assistive technology announces the error
 * when it appears; a `role` set on the element replaces it.
 *
 * @example
 * ```html
 * <div *nxaMessageError="let error" nxaErrorRoot>{{ error() }}</div>
 * ```
 */
@Directive({ selector: '[nxaErrorRoot]', host: { role: 'alert' } })
export class NxaErrorRoot {}
