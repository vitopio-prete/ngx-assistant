import {
  DestroyRef,
  Directive,
  InjectionToken,
  Injector,
  Provider,
  Signal,
  TemplateRef,
  ViewContainerRef,
  computed,
  effect,
  inject,
  isSignal,
} from '@angular/core';
import type { AssistantRuntime, ThreadSuggestion } from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';
import { KeyedViews, type NxaRowContext } from '../messages/keyed-views';
import {
  NXA_ASSISTANT,
  injectThread,
  provideSuggestionScope,
  type SuggestionRuntime,
  type SuggestionState,
} from '../scopes';

/** A configured suggestion: a prompt that is also its title, or a title, a label and a prompt. */
export type SuggestionConfig = string | { title: string; label: string; prompt: string };

/** The template context of `*nxaSuggestions`: `let suggestion` is a `Signal` of the suggestion. */
export type NxaSuggestionsContext = NxaRowContext<SuggestionState>;

/** Provided suggestions, and the assistant they were provided with (`null` above every runtime). */
interface ProvidedSuggestions {
  readonly assistant: AssistantRuntime | null;
  readonly list: Signal<readonly SuggestionState[]>;
}

const NXA_SUGGESTIONS = new InjectionToken<ProvidedSuggestions>('NXA_SUGGESTIONS');

/**
 * The keys of a list of suggestions: each suggestion is keyed by its content, and a repeated
 * suggestion by its content and how many equal ones come before it.
 */
export function getSuggestionKeys(suggestions: readonly SuggestionState[]): string[] {
  const seen = new Map<string, number>();
  return suggestions.map((suggestion) => {
    const content = JSON.stringify([suggestion.title, suggestion.label, suggestion.prompt]);
    const occurrence = seen.get(content) ?? 0;
    seen.set(content, occurrence + 1);
    return occurrence === 0 ? content : `${content}:${occurrence}`;
  });
}

// `forEach` skips the holes of a sparse array, so those never become rows.
const dense = <T, R>(items: readonly T[], map: (item: T) => R): R[] => {
  const result: R[] = [];
  items.forEach((item) => result.push(map(item)));
  return result;
};

const fromConfig = (config: SuggestionConfig): SuggestionState =>
  typeof config === 'string'
    ? { title: config, label: '', prompt: config }
    : { title: config.title, label: config.label, prompt: config.prompt };

const fromThread = (suggestion: ThreadSuggestion): SuggestionState => ({
  title: suggestion.title ?? suggestion.prompt,
  label: suggestion.label ?? '',
  prompt: suggestion.prompt,
});

const sameSuggestions = (a: readonly SuggestionState[], b: readonly SuggestionState[]) => {
  const aKeys = getSuggestionKeys(a);
  const bKeys = getSuggestionKeys(b);
  return aKeys.length === bKeys.length && aKeys.every((key, index) => key === bKeys[index]);
};

/**
 * Provides the suggestions that `*nxaSuggestions` renders in place of the thread's own: a list,
 * or a `Signal` of one to change them over time. A string is a prompt that is also the title.
 * They belong to the runtime provided in the same injector, or above them; a runtime provided
 * further down shows its own thread's suggestions again.
 *
 * @example
 * ```ts
 * providers: [
 *   provideLocalRuntime(model),
 *   provideSuggestions(['What can you do?', { title: 'Weather', label: 'in Rome', prompt: 'What is the weather in Rome?' }]),
 * ]
 * ```
 */
export function provideSuggestions(
  suggestions: readonly SuggestionConfig[] | Signal<readonly SuggestionConfig[]>,
): Provider[] {
  return [
    {
      provide: NXA_SUGGESTIONS,
      useFactory: (): ProvidedSuggestions => ({
        assistant: inject(NXA_ASSISTANT, { optional: true }) ?? null,
        list: computed(
          () => dense(isSignal(suggestions) ? suggestions() : suggestions, fromConfig),
          { equal: sameSuggestions },
        ),
      }),
    },
  ];
}

/** The provided suggestions, unless a runtime below them took over. */
function injectProvidedSuggestions(): Signal<readonly SuggestionState[]> | null {
  const provided = inject(NXA_SUGGESTIONS, { optional: true });
  if (!provided) return null;
  if (provided.assistant === null) return provided.list;
  return provided.assistant === inject(NXA_ASSISTANT, { optional: true }) ? provided.list : null;
}

/** A suggestion row's scope. Its suggestion never changes, since the row is keyed by it. */
const suggestionRuntime = (state: SuggestionState): SuggestionRuntime => ({
  getState: () => state,
  subscribe: () => () => undefined,
});

/**
 * Renders its template once per suggestion: those of `provideSuggestions(...)` when an ancestor
 * provides them, otherwise those of the nearest thread (from its runtime's suggestion adapter),
 * whose title falls back to the prompt. Each row is a suggestion scope: inside it
 * `injectSuggestion()` is the row's suggestion.
 *
 * Rows are keyed by the suggestion's content: a suggestion keeps its row when one before it goes
 * away, and equal suggestions get a row each. The context gives `let suggestion` (a `Signal` of
 * the suggestion), `index`, `count`, `first` and `last`.
 *
 * @example
 * ```html
 * <button *nxaSuggestions="let suggestion" nxaSuggestionTrigger send>
 *   <span nxaSuggestionTitle></span> <span nxaSuggestionDescription></span>
 * </button>
 * ```
 */
@Directive({ selector: '[nxaSuggestions]' })
export class NxaSuggestions {
  private readonly suggestions =
    injectProvidedSuggestions() ??
    fromRuntime(injectThread(), (s) => dense(s.suggestions, fromThread), {
      equal: sameSuggestions,
    });

  // Types the template context; `ctx` is only used in the type predicate.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static ngTemplateContextGuard(_dir: NxaSuggestions, ctx: unknown): ctx is NxaSuggestionsContext {
    return true;
  }

  constructor() {
    const views = new KeyedViews<SuggestionState, SuggestionRuntime>(
      inject(ViewContainerRef),
      inject(TemplateRef<NxaSuggestionsContext>),
      inject(Injector),
      provideSuggestionScope,
    );
    effect(() => {
      const suggestions = this.suggestions();
      const keys = getSuggestionKeys(suggestions);
      views.update(
        suggestions.map((suggestion, index) => ({
          key: keys[index]!,
          create: () => suggestionRuntime(suggestion),
        })),
      );
    });
    inject(DestroyRef).onDestroy(() => views.clear());
  }
}
