import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  NxaModelPicker as NxaModelPickerDirective,
  NxaModelPickerContent,
  NxaModelPickerEffort,
  NxaModelPickerEffortItem,
  NxaModelPickerItem,
  NxaModelPickerList,
  NxaModelPickerSearch,
  NxaModelPickerTrigger,
} from '@ngx-assistant/angular';
import { NxaIcon } from '../icons';

/**
 * A model selector, the styled `nxaModelPicker`: a compact button with the chosen model (and its reasoning effort) that opens a
 * panel with a search, the models and, for a model that has them, the effort levels. The choice
 * goes in the model context of the nearest runtime, so every run asks for that model.
 *
 * - `models`: the models to pick from (`ModelOption[]`).
 * - `value` (two-way): the id of the chosen model; when unset, the first model.
 * - `effort` (two-way): the chosen effort level.
 * - `open` (two-way): whether the panel is shown.
 * - `side`: whether the panel opens below the button (default) or above it, as in a composer at
 *   the bottom of the page.
 * - `searchable`: shows the search; by default only for more than five models.
 *
 * The panel is placed next to the button with CSS, inside the selector: the picker closes when the
 * focus leaves it, so the panel stays in its element.
 *
 * @example
 * ```html
 * <nxa-model-selector [models]="models" [(value)]="model" side="top" />
 * ```
 */
@Component({
  selector: 'nxa-model-selector',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaModelPickerTrigger,
    NxaModelPickerContent,
    NxaModelPickerSearch,
    NxaModelPickerList,
    NxaModelPickerItem,
    NxaModelPickerEffort,
    NxaModelPickerEffortItem,
    NxaIcon,
  ],
  hostDirectives: [
    {
      directive: NxaModelPickerDirective,
      inputs: ['models', 'value', 'effort', 'open'],
      outputs: ['valueChange', 'effortChange', 'openChange'],
    },
  ],
  host: { class: 'relative inline-block text-nxa-foreground', 'data-slot': 'model-selector' },
  template: `
    <button
      nxaModelPickerTrigger
      data-slot="model-selector-trigger"
      [attr.aria-label]="label()"
      class="flex h-8 max-w-56 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-nxa-muted-foreground outline-none transition-colors hover:bg-nxa-accent hover:text-nxa-foreground focus-visible:ring-2 focus-visible:ring-nxa-ring data-[state=open]:bg-nxa-accent data-[state=open]:text-nxa-foreground"
    >
      <span class="truncate">{{ picker.selectedModel()?.name ?? 'Select model' }}</span>
      @if (effortName(); as effort) {
        <span class="shrink-0 font-normal">· {{ effort }}</span>
      }
      <nxa-icon name="chevron-down" class="size-3.5 shrink-0" />
    </button>
    <div
      nxaModelPickerContent
      data-slot="model-selector-content"
      [class.top-full]="side() === 'bottom'"
      [class.mt-1.5]="side() === 'bottom'"
      [class.bottom-full]="side() === 'top'"
      [class.mb-1.5]="side() === 'top'"
      class="absolute start-0 z-50 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-xl border border-nxa-border bg-nxa-background p-1.5 shadow-lg"
    >
      @if (isSearchable()) {
        <div class="relative">
          <nxa-icon
            name="search"
            class="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-nxa-muted-foreground"
          />
          <input
            nxaModelPickerSearch
            aria-label="Search models"
            placeholder="Search models"
            data-slot="model-selector-search"
            class="h-8 w-full rounded-lg bg-nxa-muted px-3 ps-8 text-sm outline-none placeholder:text-nxa-muted-foreground focus-visible:ring-1 focus-visible:ring-nxa-ring"
          />
        </div>
      }
      <div
        nxaModelPickerList
        aria-label="Models"
        data-slot="model-selector-list"
        class="flex max-h-64 flex-col gap-0.5 overflow-y-auto outline-none"
      >
        @for (option of picker.filteredModels(); track option.id) {
          <div
            [nxaModelPickerItem]="option"
            data-slot="model-selector-item"
            class="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm select-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-nxa-accent data-highlighted:text-nxa-accent-foreground"
          >
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="truncate">{{ option.name }}</span>
              @if (option.description) {
                <span class="truncate text-xs text-nxa-muted-foreground">{{
                  option.description
                }}</span>
              }
            </div>
            <nxa-icon
              name="check"
              class="size-4 shrink-0"
              [class.invisible]="picker.selectedId() !== option.id"
            />
          </div>
        } @empty {
          <div
            data-slot="model-selector-empty"
            class="px-2.5 py-3 text-sm text-nxa-muted-foreground"
          >
            No models found
          </div>
        }
      </div>
      <div
        nxaModelPickerEffort
        aria-label="Reasoning effort"
        data-slot="model-selector-effort"
        class="flex items-center gap-1 border-t border-nxa-border px-1 pt-1.5"
      >
        <span aria-hidden="true" class="me-auto text-xs text-nxa-muted-foreground">Effort</span>
        @for (level of picker.efforts() ?? []; track level.id) {
          <button
            [nxaModelPickerEffortItem]="level.id"
            data-slot="model-selector-effort-item"
            class="rounded-md px-2 py-1 text-xs text-nxa-muted-foreground outline-none hover:bg-nxa-accent focus-visible:ring-2 focus-visible:ring-nxa-ring aria-checked:bg-nxa-accent aria-checked:font-medium aria-checked:text-nxa-foreground"
          >
            {{ level.name }}
          </button>
        }
      </div>
    </div>
  `,
})
export class NxaModelSelector {
  /** Whether the panel opens below the button or above it. */
  readonly side = input<'top' | 'bottom'>('bottom');
  /** Shows the search; by default only for more than five models. */
  readonly searchable = input<boolean | undefined>(undefined);

  protected readonly picker = inject(NxaModelPickerDirective, { self: true });
  protected readonly isSearchable = computed(
    () => this.searchable() ?? this.picker.models().length > 5,
  );
  /** The name of the trigger: a combobox does not take it from its text. */
  protected readonly label = computed(() => {
    const name = this.picker.selectedModel()?.name;
    if (!name) return 'Select model';
    const effort = this.effortName();
    return effort ? `Model: ${name}, ${effort} effort` : `Model: ${name}`;
  });
  /** The name of the effort level that applies to the chosen model. */
  protected readonly effortName = computed(() => {
    const id = this.picker.activeEffort();
    return id === undefined ? undefined : this.picker.efforts()?.find((e) => e.id === id)?.name;
  });
}
