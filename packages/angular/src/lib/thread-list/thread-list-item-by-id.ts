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
  untracked,
} from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectThreadList, provideThreadListItemScope } from '../scopes';

/**
 * Renders its template in the scope of the thread with the given id: inside it
 * `injectThreadListItem()` is that thread, as in a row of `*nxaThreadListItems`. Use it to render
 * the threads in an order of your own, such as filtered by a search or grouped by day. A change of
 * id renders it again for the new thread. An id the thread list does not know renders nothing until
 * the thread arrives, and a thread that goes away removes it.
 *
 * @example
 * ```html
 * @for (id of visibleIds(); track id) {
 *   <div *nxaThreadListItemById="id" nxaThreadListItemRoot>
 *     <button nxaThreadListItemTrigger><span nxaThreadListItemTitle></span></button>
 *   </div>
 * }
 * ```
 */
@Directive({ selector: '[nxaThreadListItemById]' })
export class NxaThreadListItemById {
  readonly nxaThreadListItemById = input.required<string>();

  constructor() {
    const threads = injectThreadList();
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

    const items = fromRuntime(threads, (s) => s.threadItems);
    const exists = computed(() => Object.hasOwn(items(), this.nxaThreadListItemById()));
    effect(() => {
      const id = this.nxaThreadListItemById();
      const show = exists();
      untracked(() => {
        clear();
        if (!show) return;
        const runtime = threads.getItemById(id);
        const injector = Injector.create({
          providers: provideThreadListItemScope(() => runtime),
          parent,
        }) as Injector & { destroy(): void };
        const view = container.createEmbeddedView(template, {}, { injector });
        current = { view, injector };
      });
    });
    inject(DestroyRef).onDestroy(clear);
  }
}
