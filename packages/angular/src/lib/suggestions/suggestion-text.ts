import { Directive } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectSuggestion } from '../scopes';

/**
 * Renders the title of the nearest suggestion as the element's text.
 *
 * @example
 * ```html
 * <span nxaSuggestionTitle></span>
 * ```
 */
@Directive({ selector: '[nxaSuggestionTitle]', host: { '[textContent]': 'title()' } })
export class NxaSuggestionTitle {
  protected readonly title = fromRuntime(injectSuggestion(), (s) => s.title);
}

/**
 * Renders the label of the nearest suggestion as the element's text.
 *
 * @example
 * ```html
 * <span nxaSuggestionDescription></span>
 * ```
 */
@Directive({ selector: '[nxaSuggestionDescription]', host: { '[textContent]': 'label()' } })
export class NxaSuggestionDescription {
  protected readonly label = fromRuntime(injectSuggestion(), (s) => s.label);
}
