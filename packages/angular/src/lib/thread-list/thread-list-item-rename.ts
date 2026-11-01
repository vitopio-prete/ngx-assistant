import {
  DestroyRef,
  Directive,
  ElementRef,
  EnvironmentInjector,
  Injector,
  TemplateRef,
  ViewContainerRef,
  afterNextRender,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import type { ThreadListItemRuntimeState } from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';
import { conditionalView } from '../messages/conditional-view';
import { injectThreadListItem, injectThreadListItemUi } from '../scopes';
import { NXA_THREAD_LIST_ITEM_FOCUS } from './thread-list-state';

/**
 * A button that starts editing the title of the nearest thread list item: it sets
 * `injectThreadListItemUi().isRenaming`, which shows an `input[nxaThreadListItemRenameInput]`
 * placed under `*nxaThreadListItemIf="{ renaming: true }"`. A capture-phase `click` listener can
 * veto it with `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaThreadListItemRename>Rename</button>
 * ```
 */
@Directive({
  selector: 'button[nxaThreadListItemRename]',
  host: { type: 'button', '[disabled]': 'disabled()', '(click)': 'onClick($event)' },
})
export class NxaThreadListItemRename {
  /** Disables the button. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly ui = injectThreadListItemUi();

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.disabled()) return;
    this.ui.isRenaming.set(true);
  }
}

/**
 * An input that edits the title of the nearest thread list item. It starts with the current title,
 * takes the focus and selects its text.
 *
 * Enter and leaving the input confirm the value, without the spaces at its ends; a blank value or
 * the current title only ends the editing. Escape ends it without renaming. Enter and Escape are
 * left alone while an IME composition is open. Editing ends by setting
 * `injectThreadListItemUi().isRenaming` to `false`; after Enter or Escape the focus goes back to
 * the item's trigger.
 *
 * A rename the runtime rejects keeps the input, with what was typed, so it can be tried again; the
 * error is reported with `console.error`. While a rename is pending, further confirmations and
 * Escape are ignored. The focus moves only if the user has not put it elsewhere meanwhile. A capture-phase `keydown` listener can veto Enter and Escape with `preventDefault()`.
 * Give the input an accessible name, such as `aria-label="Rename thread"`.
 *
 * @example
 * ```html
 * <div *nxaThreadListItems nxaThreadListItemRoot>
 *   <input *nxaThreadListItemIf="{ renaming: true }; else trigger"
 *     nxaThreadListItemRenameInput aria-label="Rename thread" />
 *   <ng-template #trigger>
 *     <button nxaThreadListItemTrigger><span nxaThreadListItemTitle></span></button>
 *   </ng-template>
 *   <button nxaThreadListItemRename>Rename</button>
 * </div>
 * ```
 */
@Directive({
  selector: 'input[nxaThreadListItemRenameInput]',
  host: { '(keydown)': 'onKeydown($event)', '(blur)': 'commit(false)' },
})
export class NxaThreadListItemRenameInput {
  private readonly item = injectThreadListItem();
  private readonly ui = injectThreadListItemUi();
  private readonly focus = inject(NXA_THREAD_LIST_ITEM_FOCUS, { optional: true });
  private readonly element: HTMLInputElement = inject(ElementRef).nativeElement;
  private readonly environment = inject(EnvironmentInjector);
  private readonly injector = inject(Injector);
  /** Set from a confirmation until it fails, or until editing starts again. */
  private settled = false;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    this.start();
    // An input that stays in the DOM starts a fresh edit each time editing starts again.
    let wasRenaming = untracked(this.ui.isRenaming);
    effect(() => {
      const isRenaming = this.ui.isRenaming();
      if (isRenaming && !wasRenaming) untracked(() => this.start());
      wasRenaming = isRenaming;
    });
  }

  private start() {
    this.settled = false;
    this.element.value = this.item.getState().title ?? '';
    // An input that stays in the DOM takes the focus only when editing starts.
    if (!untracked(this.ui.isRenaming)) return;
    afterNextRender(
      () => {
        this.element.focus();
        this.element.select();
      },
      { injector: this.injector },
    );
  }

  /** Whether moving the focus would not take it from where the user put it meanwhile. */
  private focusIsFree() {
    const active = this.element.ownerDocument.activeElement;
    return !active || active === this.element.ownerDocument.body || active === this.element;
  }

  protected onKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    // Enter and Escape belong to an open IME composition; 229 is what some browsers send then.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commit(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (this.settled) return;
      this.settled = true;
      this.end(true);
    }
  }

  protected commit(restoreFocus: boolean) {
    if (this.settled) return;
    this.settled = true;
    const next = this.element.value.trim();
    if (!next || next === (this.item.getState().title ?? '')) {
      this.end(restoreFocus);
      return;
    }
    // A runtime may also throw before it returns a promise.
    Promise.resolve()
      .then(() => this.item.rename(next))
      .then(
        () => this.end(restoreFocus),
        (error: unknown) => {
          console.error('[ngx-assistant] Renaming the thread failed', error);
          this.settled = false;
          if (restoreFocus && this.element.isConnected && this.focusIsFree()) this.element.focus();
        },
      );
  }

  private end(restoreFocus: boolean) {
    // Without a change there is no render to wait for: nothing is swapped.
    const changed = untracked(this.ui.isRenaming);
    this.ui.isRenaming.set(false);
    // Editing that starts again in the same task leaves this input in place, unseen by the
    // effect: start afresh once rendered. A removed input does not.
    if (changed && !this.destroyed) {
      afterNextRender(
        () => {
          if (untracked(this.ui.isRenaming)) this.start();
        },
        { injector: this.injector },
      );
    }
    const focus = this.focus;
    if (!restoreFocus || !focus || !this.focusIsFree()) return;
    const document = this.element.ownerDocument;
    const restore = () => {
      // A removed input has left the focus to the body.
      const active = document.activeElement;
      if (active && active !== document.body && active !== this.element) return;
      if (focus.trigger?.isConnected) focus.trigger.focus();
    };
    if (!changed) {
      restore();
      return;
    }
    // After the render that swaps the input for the trigger.
    afterNextRender(restore, { injector: this.environment });
  }
}

/**
 * The conditions of `*nxaThreadListItemIf`. Every condition given must hold; a missing condition
 * is not checked.
 */
export interface NxaThreadListItemIfConditions {
  /** The title is being edited (`injectThreadListItemUi().isRenaming`). */
  renaming?: boolean;
  /** The thread is the main one. */
  main?: boolean;
  /** The thread is archived. */
  archived?: boolean;
}

const matches = (
  when: NxaThreadListItemIfConditions,
  s: ThreadListItemRuntimeState,
  isRenaming: boolean,
) =>
  (when.renaming === undefined || when.renaming === isRenaming) &&
  (when.main === undefined || when.main === s.isMain) &&
  (when.archived === undefined || when.archived === (s.status === 'archived'));

/**
 * Renders its template while the nearest thread list item meets every condition given, and the
 * `else` template otherwise.
 *
 * @example
 * ```html
 * <input *nxaThreadListItemIf="{ renaming: true }; else title" nxaThreadListItemRenameInput />
 * ```
 */
@Directive({ selector: '[nxaThreadListItemIf]' })
export class NxaThreadListItemIf {
  readonly nxaThreadListItemIf = input.required<NxaThreadListItemIfConditions>();
  readonly nxaThreadListItemIfElse = input<TemplateRef<unknown> | null>(null);

  private readonly state = fromRuntime(injectThreadListItem());
  private readonly ui = injectThreadListItemUi();

  constructor() {
    conditionalView(
      inject(ViewContainerRef),
      inject(TemplateRef),
      computed(() => matches(this.nxaThreadListItemIf(), this.state(), this.ui.isRenaming())),
      this.nxaThreadListItemIfElse,
    );
  }
}
