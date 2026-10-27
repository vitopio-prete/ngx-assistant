import { DestroyRef, Directive, ElementRef, computed, inject, input } from '@angular/core';
import { NxaModelPicker } from './model-picker';
import type { ModelOption } from './model-options';

const registerElement = (register: (element: HTMLElement) => () => void) => {
  const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  inject(DestroyRef).onDestroy(register(element));
};

/**
 * The button that opens and closes the content, a select-only combobox: the focus stays on it
 * while the list is open, and `aria-activedescendant` names the highlighted option. Click, Enter
 * and Space toggle; ArrowDown and ArrowUp open; once open, the arrows, Home and End move, Enter and
 * Space pick, Escape closes.
 */
@Directive({
  selector: 'button[nxaModelPickerTrigger]',
  host: {
    type: 'button',
    role: 'combobox',
    'aria-haspopup': 'listbox',
    '[attr.aria-expanded]': 'picker.open()',
    '[attr.aria-controls]': 'picker.listId',
    '[attr.aria-activedescendant]': 'picker.activeDescendant()',
    '[attr.data-state]': "picker.open() ? 'open' : 'closed'",
    '(click)': 'picker.toggle()',
    '(keydown)': 'onKeydown($event)',
    '(keyup)': 'onKeyup($event)',
  },
})
export class NxaModelPickerTrigger {
  protected readonly picker = inject(NxaModelPicker);

  constructor() {
    registerElement((element) => this.picker.registerTrigger(element));
  }

  // A Space that picked an option must not reach the click of its keyup, which would reopen.
  private spacePicked = false;

  protected onKeydown(event: KeyboardEvent): void {
    if (this.picker.handleKey(event)) return;
    if (event.isComposing) return;
    if (this.picker.open() && event.key === ' ') {
      this.spacePicked = true;
      this.picker.pickHighlighted(event);
    } else if (!this.picker.open() && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      this.picker.show();
    }
  }

  protected onKeyup(event: KeyboardEvent): void {
    if (event.key !== ' ' || !this.spacePicked) return;
    this.spacePicked = false;
    event.preventDefault();
  }
}

/**
 * What opens: `hidden` while closed, `data-state="open|closed"`. It holds the list, and
 * optionally a search and the effort levels. A pointer down on a part of it that takes no focus
 * keeps the focus where it is, so the keyboard keeps driving the list.
 */
@Directive({
  selector: '[nxaModelPickerContent]',
  host: {
    '[attr.hidden]': "picker.open() ? null : ''",
    '[attr.data-state]': "picker.open() ? 'open' : 'closed'",
    '(pointerdown)': 'onPointerDown($event)',
  },
})
export class NxaModelPickerContent {
  protected readonly picker = inject(NxaModelPicker);

  protected onPointerDown(event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('input, textarea, select, button, [tabindex]')) event.preventDefault();
  }
}

/**
 * The list of models: `role="listbox"`, with only `[nxaModelPickerItem]` options inside. Give it
 * an `aria-label`. The trigger and the search control it.
 */
@Directive({
  selector: '[nxaModelPickerList]',
  host: {
    role: 'listbox',
    '[id]': 'picker.listId',
  },
})
export class NxaModelPickerList {
  protected readonly picker = inject(NxaModelPicker);
}

/**
 * One model of the list: `role="option"` with `aria-selected`, `aria-disabled`, and
 * `data-selected`, `data-highlighted`, `data-disabled`. A click picks it and closes the list; the
 * pointer moving over it highlights it.
 */
@Directive({
  selector: '[nxaModelPickerItem]',
  host: {
    role: 'option',
    '[id]': 'id()',
    '[attr.aria-selected]': 'selected()',
    '[attr.aria-disabled]': 'disabled() || null',
    '[attr.data-selected]': "selected() ? '' : null",
    '[attr.data-highlighted]': "highlighted() ? '' : null",
    '[attr.data-disabled]': "disabled() ? '' : null",
    // Keeps the focus where it is (trigger or search) when the option is pressed.
    '(pointerdown)': '$event.preventDefault()',
    '(click)': 'picker.select(option().id)',
    '(pointermove)': 'onPointerMove()',
  },
})
export class NxaModelPickerItem {
  readonly option = input.required<ModelOption>({ alias: 'nxaModelPickerItem' });

  protected readonly picker = inject(NxaModelPicker);
  protected readonly id = computed(() => this.picker.optionId(this.option().id));
  protected readonly selected = computed(() => this.picker.selectedId() === this.option().id);
  protected readonly highlighted = computed(() => this.picker.highlightedId() === this.option().id);
  protected readonly disabled = computed(() => !!this.option().disabled);

  protected onPointerMove(): void {
    if (!this.disabled() && !this.highlighted()) this.picker.highlight(this.option().id);
  }
}

/**
 * The search of the list, inside the content and outside the list: it filters `filteredModels()`
 * by id, name and keywords. It takes the focus when the content opens and drives the list from the
 * keyboard like the trigger. Cleared on close.
 */
@Directive({
  selector: 'input[nxaModelPickerSearch]',
  host: {
    type: 'text',
    role: 'combobox',
    autocomplete: 'off',
    'aria-autocomplete': 'list',
    '[attr.aria-expanded]': 'picker.open()',
    '[attr.aria-controls]': 'picker.listId',
    '[attr.aria-activedescendant]': 'picker.activeDescendant()',
    '(input)': 'picker.query.set($any($event.target).value)',
    '(keydown)': 'picker.handleKey($event)',
  },
})
export class NxaModelPickerSearch {
  protected readonly picker = inject(NxaModelPicker);

  constructor() {
    registerElement((element) => this.picker.registerSearch(element as HTMLInputElement));
  }
}

/**
 * The effort levels of the chosen model: `role="radiogroup"`, `hidden` when the model has none.
 * Render a `button[nxaModelPickerEffortItem]` for each of `picker.efforts()`. The arrows move to
 * the next or previous level and choose it.
 */
@Directive({
  selector: '[nxaModelPickerEffort]',
  host: {
    role: 'radiogroup',
    '[attr.hidden]': 'picker.efforts() ? null : ""',
    '(keydown)': 'onKeydown($event)',
  },
})
export class NxaModelPickerEffort {
  protected readonly picker = inject(NxaModelPicker);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected onKeydown(event: KeyboardEvent): void {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    const items = Array.from(
      this.host.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
    ).filter((item) => !item.disabled);
    const index = items.findIndex((item) => item === event.target);
    if (index === -1 || items.length === 0) return;
    event.preventDefault();
    // Stops the trigger or the list from seeing the arrow too.
    event.stopPropagation();
    const next = items[(index + step + items.length) % items.length]!;
    next.focus();
    next.click();
  }
}

/**
 * One effort level: `role="radio"` with `aria-checked` and `data-state="checked|unchecked"`. A
 * click chooses it; only the checked level (or the first one) is in the tab order.
 */
@Directive({
  selector: 'button[nxaModelPickerEffortItem]',
  host: {
    type: 'button',
    role: 'radio',
    '[attr.aria-checked]': 'checked()',
    '[attr.data-state]': "checked() ? 'checked' : 'unchecked'",
    '[attr.tabindex]': 'tabbable() ? 0 : -1',
    '(click)': 'picker.setEffort(effortId())',
  },
})
export class NxaModelPickerEffortItem {
  readonly effortId = input.required<string>({ alias: 'nxaModelPickerEffortItem' });

  protected readonly picker = inject(NxaModelPicker);
  protected readonly checked = computed(() => this.picker.activeEffort() === this.effortId());
  protected readonly tabbable = computed(() => {
    const active = this.picker.activeEffort();
    return active === undefined
      ? this.picker.efforts()?.[0]?.id === this.effortId()
      : this.checked();
  });
}
