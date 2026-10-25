import { Directive, TemplateRef, ViewContainerRef, computed, inject, input } from '@angular/core';
import type { ComposerState } from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';
import { conditionalView } from '../messages/conditional-view';
import { injectComposer } from '../scopes';

/**
 * The conditions of `*nxaComposerIf`. Every condition given must hold; a missing condition is not
 * checked.
 */
export interface NxaComposerIfConditions {
  /** The composer is editing: for an edit composer, its message is being edited. */
  editing?: boolean;
  /** Dictation is active. */
  dictation?: boolean;
}

const matches = (when: NxaComposerIfConditions, s: ComposerState) =>
  (when.editing === undefined || when.editing === s.isEditing) &&
  (when.dictation === undefined || when.dictation === (s.dictation != null));

/**
 * Renders its template while the nearest composer meets every condition given, and the `else`
 * template otherwise. Inside a message the nearest composer is the message's edit composer, so
 * the message can swap its content for an edit form.
 *
 * @example
 * ```html
 * <form *nxaComposerIf="{ editing: true }; else view" nxaComposerRoot>
 *   <textarea nxaComposerInput aria-label="Edit message"></textarea>
 *   <button nxaComposerCancel>Cancel</button>
 *   <button nxaComposerSend>Save</button>
 * </form>
 * <ng-template #view>...</ng-template>
 * ```
 */
@Directive({ selector: '[nxaComposerIf]' })
export class NxaComposerIf {
  readonly nxaComposerIf = input.required<NxaComposerIfConditions>();
  readonly nxaComposerIfElse = input<TemplateRef<unknown> | null>(null);

  private readonly state = fromRuntime(injectComposer());

  constructor() {
    conditionalView(
      inject(ViewContainerRef),
      inject(TemplateRef),
      computed(() => matches(this.nxaComposerIf(), this.state())),
      this.nxaComposerIfElse,
    );
  }
}
