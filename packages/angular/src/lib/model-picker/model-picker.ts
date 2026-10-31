import {
  DestroyRef,
  Directive,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { registerModelContext } from '../model-context/model-context-binding';
import { injectAssistant } from '../scopes';
import {
  getModelEfforts,
  matchesModelQuery,
  resolveModelEffort,
  type ModelEffortOption,
  type ModelOption,
} from './model-options';

let nextPickerId = 0;

const NO_CONTEXT = () => ({});

/**
 * A model picker: the list of models, the chosen one and its reasoning effort. The choice goes in
 * the model context of the nearest runtime (`config.modelName`, and `config.reasoningEffort` when
 * the model supports the chosen effort), so every run of that runtime asks for it: the request
 * body of `provideDataStreamRuntime(...)` and `provideAssistantTransportRuntime(...)` carries it.
 * Without a runtime it only keeps the state.
 *
 * Headless: it gives behavior, ARIA and `data-*` state, no styles and no positioning. Put the
 * trigger and the content inside it, and in the content the list with its items, a search and the
 * effort levels. The content is shown in place; a pointer down outside the picker, the focus
 * leaving it, or Escape inside it closes it.
 *
 * - `models`: the models to pick from.
 * - `value` (two-way): the id of the chosen model; when unset, the first model.
 * - `effort` (two-way): the chosen effort. It stays across model switches; `activeEffort()` is the
 *   one that applies to the chosen model.
 * - `open` (two-way): whether the content is shown.
 *
 * Through `#picker="nxaModelPicker"`: `selectedModel()`, `efforts()`, `activeEffort()`,
 * `filteredModels()` (the models matching the search), `highlightedId()`.
 *
 * Sets `data-state="open|closed"`.
 *
 * @example
 * ```html
 * <div nxaModelPicker #picker="nxaModelPicker" [models]="models" [(value)]="model">
 *   <button nxaModelPickerTrigger>{{ picker.selectedModel()?.name ?? 'Select model' }}</button>
 *   <div nxaModelPickerContent>
 *     <input nxaModelPickerSearch placeholder="Search models" />
 *     <div nxaModelPickerList aria-label="Models">
 *       @for (option of picker.filteredModels(); track option.id) {
 *         <div [nxaModelPickerItem]="option">{{ option.name }}</div>
 *       }
 *     </div>
 *   </div>
 * </div>
 * ```
 */
@Directive({
  selector: '[nxaModelPicker]',
  exportAs: 'nxaModelPicker',
  host: {
    '[attr.data-state]': "open() ? 'open' : 'closed'",
    '(keydown)': 'onKeydown($event)',
    '(focusout)': 'onFocusOut($event)',
  },
})
export class NxaModelPicker {
  readonly models = input<readonly ModelOption[]>([]);
  readonly value = model<string | undefined>(undefined);
  readonly effort = model<string | undefined>(undefined);
  readonly open = model(false);

  /** The base of the ids of the list and of its options. */
  readonly id = `nxa-model-picker-${nextPickerId++}`;
  readonly listId = `${this.id}-list`;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private trigger: HTMLElement | null = null;
  private search: HTMLInputElement | null = null;

  /** The text of the search. Cleared when the content closes. */
  readonly query = signal('');
  private readonly highlighted = signal<string | undefined>(undefined);

  /** The id of the chosen model: `value`, or the first model when unset. */
  readonly selectedId = computed(() => this.value() ?? this.models()[0]?.id);
  readonly selectedModel = computed(() => this.models().find((m) => m.id === this.selectedId()));
  /** The effort levels of the chosen model, or `undefined` when they are not configurable. */
  readonly efforts = computed((): readonly ModelEffortOption[] | undefined =>
    getModelEfforts(this.selectedModel()),
  );
  /** The chosen effort if the chosen model supports it, else `undefined`. */
  readonly activeEffort = computed(() =>
    resolveModelEffort(this.models(), this.selectedId(), this.effort()),
  );
  /** The models matching the search, in their order. */
  readonly filteredModels = computed(() =>
    this.models().filter((m) => matchesModelQuery(m, this.query())),
  );
  private readonly enabledModels = computed(() => this.filteredModels().filter((m) => !m.disabled));
  /**
   * The id of the option the keyboard is on, while the content is open: the one last moved to,
   * else the chosen model, else the first enabled option left by the search.
   */
  readonly highlightedId = computed(() => {
    if (!this.open()) return undefined;
    const enabled = this.enabledModels();
    const candidate = (id: string | undefined) =>
      id !== undefined && enabled.some((m) => m.id === id) ? id : undefined;
    return candidate(this.highlighted()) ?? candidate(this.selectedId()) ?? enabled[0]?.id;
  });
  private readonly optionIndexes = computed(
    () => new Map(this.models().map((m, index) => [m.id, index] as const)),
  );
  /** The element id of the highlighted option, for `aria-activedescendant`. */
  readonly activeDescendant = computed(() => {
    const id = this.highlightedId();
    return id === undefined ? null : this.optionId(id);
  });

  constructor() {
    const runtime = injectAssistant({ optional: true });
    if (runtime) {
      registerModelContext(runtime, () => {
        const modelName = this.selectedId();
        if (modelName === undefined) return NO_CONTEXT;
        const reasoningEffort = this.activeEffort();
        const context = {
          config: { modelName, ...(reasoningEffort !== undefined ? { reasoningEffort } : {}) },
        };
        return () => context;
      });
    }
    this.followOpenState();
  }

  /** The element id of the option of a model. */
  optionId(modelId: string): string {
    return `${this.id}-option-${this.optionIndexes().get(modelId) ?? 'none'}`;
  }

  /** Picks a model and closes the content. A disabled or unknown model is ignored. */
  select(modelId: string): void {
    const option = this.models().find((m) => m.id === modelId);
    if (!option || option.disabled) return;
    this.value.set(modelId);
    this.close();
  }

  /** Chooses an effort level, keeping the content open. */
  setEffort(effort: string): void {
    this.effort.set(effort);
  }

  /** Shows the content, on the chosen model, with the focus on the search if there is one. */
  show(): void {
    this.open.set(true);
  }

  /** Hides the content; `restoreFocus` moves the focus back to the trigger if it was inside. */
  close({ restoreFocus = true }: { restoreFocus?: boolean } = {}): void {
    if (!this.open()) return;
    const hadFocus = this.host.contains(this.host.ownerDocument.activeElement);
    this.open.set(false);
    if (restoreFocus && hadFocus) this.trigger?.focus();
  }

  toggle(): void {
    if (this.open()) this.close();
    else this.show();
  }

  /** Puts the keyboard on an option, as the pointer does when it moves over it. */
  highlight(modelId: string): void {
    this.highlighted.set(modelId);
  }

  /**
   * The keys of the open list, shared by the trigger and the search: the arrows, Home and End
   * move, Enter picks. Returns whether the key was handled.
   */
  handleKey(event: KeyboardEvent): boolean {
    if (!this.open() || event.isComposing) return false;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
        this.move(event.key);
        event.preventDefault();
        return true;
      case 'Enter':
        this.pickHighlighted(event);
        return true;
      default:
        return false;
    }
  }

  /** Picks the highlighted option, for Enter (and Space on the trigger). */
  pickHighlighted(event: Event): void {
    event.preventDefault();
    const id = this.highlightedId();
    if (id !== undefined) this.select(id);
  }

  /** @internal */
  registerTrigger(element: HTMLElement): () => void {
    this.trigger = element;
    return () => {
      if (this.trigger === element) this.trigger = null;
    };
  }

  /** @internal */
  registerSearch(element: HTMLInputElement): () => void {
    this.search = element;
    return () => {
      if (this.search === element) this.search = null;
    };
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.isComposing || !this.open()) return;
    event.preventDefault();
    // A dialog around the picker keeps its own Escape for when the picker is closed.
    event.stopPropagation();
    this.close();
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    // `null` is the window losing focus or a click on nothing focusable: the pointer handler
    // covers the clicks outside.
    if (next instanceof Node && !this.host.contains(next)) this.close({ restoreFocus: false });
  }

  // Opening, from `show()` or from the `open` binding, starts on the chosen model with the focus on
  // the search; closing clears the search. The outside listener only lives while open.
  private followOpenState(): void {
    const document = this.host.ownerDocument;
    const onPointerDown = (event: Event) => {
      if (event.target instanceof Node && this.host.contains(event.target)) return;
      this.close({ restoreFocus: false });
    };
    let wasOpen = false;
    effect(() => {
      const open = this.open();
      if (open === wasOpen) return;
      wasOpen = open;
      untracked(() => {
        this.highlighted.set(undefined);
        if (open) {
          document.addEventListener('pointerdown', onPointerDown, true);
          // The content is hidden until the next render.
          afterNextRender(() => this.search?.focus(), { injector: this.injector });
        } else {
          document.removeEventListener('pointerdown', onPointerDown, true);
          this.query.set('');
          if (this.search) this.search.value = '';
        }
      });
    });
    inject(DestroyRef).onDestroy(() =>
      document.removeEventListener('pointerdown', onPointerDown, true),
    );
  }

  private move(key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'): void {
    const enabled = this.enabledModels();
    if (enabled.length === 0) return;
    const index = enabled.findIndex((m) => m.id === this.highlightedId());
    const next =
      key === 'Home'
        ? 0
        : key === 'End'
          ? enabled.length - 1
          : key === 'ArrowDown'
            ? Math.min(index + 1, enabled.length - 1)
            : Math.max(index - 1, 0);
    this.highlighted.set(enabled[next]!.id);
  }
}

/** The nearest model picker, for a custom part placed inside it. */
export function injectModelPicker(): NxaModelPicker {
  const picker = inject(NxaModelPicker, { optional: true });
  if (!picker) {
    throw new Error('[ngx-assistant] No model picker here: use it inside [nxaModelPicker].');
  }
  return picker;
}
