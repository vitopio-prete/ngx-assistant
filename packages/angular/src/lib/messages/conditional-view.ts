import { TemplateRef, ViewContainerRef, effect, untracked } from '@angular/core';

/**
 * Shows `template` while `condition` is true, and `otherwise()` (when given) while it is false.
 * Must be called in an injection context; the views go with the container.
 */
export function conditionalView(
  container: ViewContainerRef,
  template: TemplateRef<unknown>,
  condition: () => boolean,
  otherwise: () => TemplateRef<unknown> | null = () => null,
) {
  let shown: TemplateRef<unknown> | null | undefined;
  effect(() => {
    const next = condition() ? template : otherwise();
    if (next === shown) return;
    shown = next;
    untracked(() => {
      container.clear();
      if (next) container.createEmbeddedView(next);
    });
  });
}
