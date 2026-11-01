import {
  DestroyRef,
  Directive,
  EmbeddedViewRef,
  Injector,
  TemplateRef,
  ViewContainerRef,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  untracked,
} from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectMessage, providePartScope } from '../scopes';

/**
 * Renders its template in the scope of the part at an index of the nearest message: inside it
 * `injectPart()` is that part. A change of index renders it again for the new part. Use it to
 * render the parts of a group, such as the reasoning parts of `*nxaReasoningGroup`. An index with no
 * part renders nothing until the part arrives.
 *
 * @example
 * ```html
 * @for (index of group.indices(); track index) {
 *   <p *nxaMessagePartByIndex="index" nxaMessagePartText></p>
 * }
 * ```
 */
@Directive({ selector: '[nxaMessagePartByIndex]' })
export class NxaMessagePartByIndex {
  readonly nxaMessagePartByIndex = input.required<number, unknown>({ transform: numberAttribute });

  constructor() {
    const message = injectMessage();
    const container = inject(ViewContainerRef);
    const template = inject(TemplateRef);
    const parent = inject(Injector);
    let current: {
      view: EmbeddedViewRef<unknown>;
      injector: Injector & { destroy(): void };
    } | null = null;
    const clear = () => {
      if (!current) return;
      current.view.destroy();
      current.injector.destroy();
      current = null;
    };

    // Renders nothing for an index the message has no part at.
    const length = fromRuntime(message, (s) => s.content.length);
    const exists = computed(() => {
      const index = this.nxaMessagePartByIndex();
      return Number.isInteger(index) && index >= 0 && index < length();
    });
    effect(() => {
      const index = this.nxaMessagePartByIndex();
      const show = exists();
      untracked(() => {
        clear();
        if (!show) return;
        const runtime = message.getMessagePartByIndex(index);
        const injector = Injector.create({
          providers: providePartScope(() => runtime),
          parent,
        }) as Injector & { destroy(): void };
        const view = container.createEmbeddedView(template, {}, { injector });
        current = { view, injector };
      });
    });
    inject(DestroyRef).onDestroy(clear);
  }
}
