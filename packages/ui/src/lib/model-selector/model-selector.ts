import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  computed,
  contentChild,
  inject,
  input,
} from '@angular/core';
import {
  NxaModelPicker as NxaModelPickerDirective,
  NxaModelPickerContent,
  NxaModelPickerEffort,
  NxaModelPickerEffortItem,
  NxaModelPickerItem,
  NxaModelPickerList,
  NxaModelPickerSearch,
  NxaModelPickerTrigger,
  type ModelOption,
} from '@ngx-assistant/angular';
import { NxaIcon } from '../icons';

/** What a `nxaModelSelectorIcon` template gets: the model to draw. */
export interface NxaModelSelectorIconContext {
  readonly $implicit: ModelOption;
}

/**
 * Draws the icon of each model in a model selector, in place of the image of `icon`: for inline
 * SVG or an icon component. It gets the model; render nothing for a model without an icon.
 *
 * @example
 * ```html
 * <nxa-model-selector [models]="models">
 *   <ng-template nxaModelSelectorIcon let-model>
 *     <my-model-icon [name]="model.id" />
 *   </ng-template>
 * </nxa-model-selector>
 * ```
 */
@Directive({ selector: 'ng-template[nxaModelSelectorIcon]' })
export class NxaModelSelectorIcon {
  readonly template = inject<TemplateRef<NxaModelSelectorIconContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _dir: NxaModelSelectorIcon,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ctx: unknown,
  ): ctx is NxaModelSelectorIconContext {
    return true;
  }
}

const TRIGGER =
  'flex max-w-56 min-w-0 items-center gap-1.5 rounded-md outline-none transition-colors hover:text-nxa-foreground focus-visible:ring-2 focus-visible:ring-nxa-ring data-[state=open]:text-nxa-foreground text-nxa-muted-foreground';
const TRIGGER_VARIANTS = {
  default: 'h-8 px-2.5 text-sm font-medium hover:bg-nxa-accent data-[state=open]:bg-nxa-accent',
  ghost: 'h-7 px-2 text-[13px]',
} as const;

/**
 * A model selector, the styled `nxaModelPicker`: a compact button with the chosen model (and its reasoning effort) that opens a
 * panel with a search, the models and, for a model that has them, the effort levels. The choice
 * goes in the model context of the nearest runtime, so every run asks for that model.
 *
 * - `models`: the models to pick from (`ModelOption[]`).
 * - `value` (two-way): the id of the chosen model; when unset, the first enabled model.
 * - `effort` (two-way): the chosen effort level.
 * - `open` (two-way): whether the panel is shown.
 * - `side`: whether the panel opens below the button (default) or above it, as in a composer at
 *   the bottom of the page.
 * - `searchable`: shows the search; by default only for more than five models.
 * - `variant`: `default`, or `ghost` for a compact button without a background, as in a composer.
 *
 * A model with `icon` shows that image beside its name, in the button and in the list; a
 * `<ng-template nxaModelSelectorIcon let-model>` inside the selector draws the icons instead. A
 * disabled model stays in the list, dimmed, with its `description` as the reason.
 *
 * The panel is placed next to the button with CSS, inside the selector: the picker closes when the
 * focus leaves it, so the panel stays in its element.
 *
 * @example
 * ```html
 * <nxa-model-selector [models]="models" [(value)]="model" side="top" />
 * <!-- in the composer of a thread -->
 * <nxa-thread>
 *   <nxa-model-selector nxaComposerTools variant="ghost" side="top" [models]="models" />
 * </nxa-thread>
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
    NgTemplateOutlet,
  ],
  hostDirectives: [
    {
      directive: NxaModelPickerDirective,
      inputs: ['models', 'value', 'effort', 'open'],
      outputs: ['valueChange', 'effortChange', 'openChange'],
    },
  ],
  host: {
    class: 'relative inline-flex max-w-full min-w-0 text-nxa-foreground',
    'data-slot': 'model-selector',
  },
  template: `
    <button
      nxaModelPickerTrigger
      data-slot="model-selector-trigger"
      [attr.aria-label]="label()"
      [attr.data-variant]="variant()"
      [class]="triggerClass()"
    >
      @if (picker.selectedModel(); as selected) {
        <ng-container *ngTemplateOutlet="iconOf; context: { $implicit: selected }" />
      }
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
        class="flex max-h-[min(16rem,40dvh)] flex-col gap-0.5 overflow-y-auto outline-none"
      >
        @for (option of picker.filteredModels(); track option.id) {
          <div
            [nxaModelPickerItem]="option"
            data-slot="model-selector-item"
            class="flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-1.5 text-sm select-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-nxa-accent data-highlighted:text-nxa-accent-foreground"
          >
            <ng-container
              *ngTemplateOutlet="iconOf; context: { $implicit: option, inList: true }"
            />
            <div class="flex min-w-0 flex-1 flex-col">
              <span data-slot="model-selector-item-name" class="truncate">{{ option.name }}</span>
              @if (option.description) {
                <span class="truncate text-xs text-nxa-muted-foreground">{{
                  option.description
                }}</span>
              }
            </div>
            <nxa-icon
              name="check"
              class="mt-0.5 size-4 shrink-0"
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

    <ng-template #iconOf let-option let-inList="inList">
      @if (iconTemplate(); as custom) {
        <span
          data-slot="model-selector-icon"
          aria-hidden="true"
          [class.mt-0.5]="inList"
          class="flex size-4 shrink-0 items-center justify-center empty:hidden [&_img]:size-3.5 [&_svg]:size-3.5"
          ><ng-container *ngTemplateOutlet="custom.template; context: { $implicit: option }"
        /></span>
      } @else if (option.icon) {
        <span
          data-slot="model-selector-icon"
          aria-hidden="true"
          [class.mt-0.5]="inList"
          class="flex size-4 shrink-0 items-center justify-center"
        >
          <img [src]="option.icon" alt="" draggable="false" class="size-3.5 object-contain" />
        </span>
      }
    </ng-template>
  `,
})
export class NxaModelSelector {
  /** Whether the panel opens below the button or above it. */
  readonly side = input<'top' | 'bottom'>('bottom');
  /** Shows the search; by default only for more than five models. */
  readonly searchable = input<boolean | undefined>(undefined);
  /** `ghost`: a compact button without a background, for a composer or a toolbar. */
  readonly variant = input<'default' | 'ghost'>('default');

  protected readonly iconTemplate = contentChild(NxaModelSelectorIcon);
  protected readonly triggerClass = computed(
    () => `${TRIGGER} ${TRIGGER_VARIANTS[this.variant()]}`,
  );

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
