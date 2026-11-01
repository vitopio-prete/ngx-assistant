import { Directive, TemplateRef, ViewContainerRef, computed, inject } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { conditionalView } from '../messages/conditional-view';
import { injectPart } from '../scopes';

/**
 * Renders its template while the nearest message part is running, for an indicator at the end of
 * a part being written.
 *
 * @example
 * ```html
 * <p><span nxaMessagePartText></span><span *nxaMessagePartInProgress>●</span></p>
 * ```
 */
@Directive({ selector: '[nxaMessagePartInProgress]' })
export class NxaMessagePartInProgress {
  private readonly running = fromRuntime(injectPart(), (s) => s.status.type === 'running');

  constructor() {
    conditionalView(
      inject(ViewContainerRef),
      inject(TemplateRef),
      computed(() => this.running()),
    );
  }
}
