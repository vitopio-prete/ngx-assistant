import {
  DestroyRef,
  Directive,
  EmbeddedViewRef,
  InjectionToken,
  Injector,
  Signal,
  TemplateRef,
  ViewContainerRef,
  WritableSignal,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import type { ToolApprovalQuestion } from '@ngx-assistant/engine';
import { injectToolApproval } from './approval-root';

const NXA_TOOL_APPROVAL_QUESTION = new InjectionToken<Signal<ToolApprovalQuestion>>(
  'NXA_TOOL_APPROVAL_QUESTION',
);

function injectQuestion(): Signal<ToolApprovalQuestion> {
  const question = inject(NXA_TOOL_APPROVAL_QUESTION, { optional: true });
  if (!question) {
    throw new Error(
      '[ngx-assistant] No approval question here: use it inside *nxaToolApprovalQuestions.',
    );
  }
  return question;
}

/** Whether a question takes a typed answer: it has no options, or allows one beside them. */
export const questionAcceptsText = (question: ToolApprovalQuestion) =>
  !question.options?.length || question.allowFreeform === true;

/** The template context of `*nxaToolApprovalQuestions`: `let question` is a `Signal` of it. */
export interface NxaToolApprovalQuestionsContext {
  $implicit: Signal<ToolApprovalQuestion>;
  index: number;
  count: number;
}

interface QuestionRow {
  id: string;
  view: EmbeddedViewRef<NxaToolApprovalQuestionsContext>;
  injector: Injector & { destroy(): void };
  question: WritableSignal<ToolApprovalQuestion>;
}

/**
 * Renders its template once per question of a `questions` request, under the nearest
 * `nxaToolApprovalRoot`. Inside a row, `nxaToolApprovalQuestionOption` and
 * `nxaToolApprovalQuestionText` answer the row's question. A row stays while the questions keep
 * their ids and order, and takes the updated question; another list of ids renders the rows again.
 * The answers are kept by the root, by question id, so they survive either way.
 *
 * @example
 * ```html
 * <fieldset *nxaToolApprovalQuestions="let question">
 *   <legend>{{ question().prompt }}</legend>
 *   @for (option of question().options; track option.id) {
 *     <button [nxaToolApprovalQuestionOption]="option.id">{{ option.label }}</button>
 *   }
 * </fieldset>
 * <button nxaToolApprovalSubmitAnswers>Send</button>
 * ```
 */
@Directive({ selector: '[nxaToolApprovalQuestions]' })
export class NxaToolApprovalQuestions {
  // Types the template context; `ctx` is only used in the type predicate.
  static ngTemplateContextGuard(
    _dir: NxaToolApprovalQuestions,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ctx: unknown,
  ): ctx is NxaToolApprovalQuestionsContext {
    return true;
  }

  private readonly state = injectToolApproval();

  constructor() {
    const container = inject(ViewContainerRef);
    const template = inject(TemplateRef<NxaToolApprovalQuestionsContext>);
    const parent = inject(Injector);
    let rows: QuestionRow[] = [];
    const clear = () => {
      for (const row of rows) {
        row.view.destroy();
        row.injector.destroy();
      }
      rows = [];
    };

    effect(() => {
      const questions = this.state.questions();
      untracked(() => {
        const sameIds =
          rows.length === questions.length &&
          rows.every((row, index) => row.id === questions[index]!.id);
        if (sameIds) {
          questions.forEach((question, index) => rows[index]!.question.set(question));
          return;
        }
        clear();
        rows = questions.map((initial, index) => {
          const question = signal(initial);
          const injector = Injector.create({
            providers: [{ provide: NXA_TOOL_APPROVAL_QUESTION, useValue: question.asReadonly() }],
            parent,
          }) as Injector & { destroy(): void };
          const view = container.createEmbeddedView(
            template,
            { $implicit: question.asReadonly(), index, count: questions.length },
            { injector },
          );
          return { id: initial.id, view, injector, question };
        });
      });
    });
    inject(DestroyRef).onDestroy(clear);
  }
}

/**
 * A button that chooses or clears one option of the question of its row. A single-choice question
 * keeps one option. Carries `aria-pressed` and `data-nxa-chosen`.
 */
@Directive({
  selector: 'button[nxaToolApprovalQuestionOption]',
  host: {
    type: 'button',
    '[disabled]': 'isDisabled()',
    '[attr.aria-pressed]': "isChosen() ? 'true' : 'false'",
    '[attr.data-nxa-chosen]': "isChosen() ? '' : null",
    '(click)': 'onClick($event)',
  },
})
export class NxaToolApprovalQuestionOption {
  /** The id of the option this button chooses. */
  readonly optionId = input.required<string>({ alias: 'nxaToolApprovalQuestionOption' });
  /** Disables the button on top of the request state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly state = injectToolApproval();
  private readonly question = injectQuestion();
  protected readonly isChosen = computed(() =>
    this.state.isChosen(this.question().id, this.optionId()),
  );
  protected readonly isDisabled = computed(() => this.disabled() || this.state.locked());

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    this.state.toggle(this.question().id, this.optionId());
  }
}

/** The typed answer to the question of its row. Disabled when the question takes none. */
@Directive({
  selector: 'textarea[nxaToolApprovalQuestionText]',
  host: {
    '[value]': 'value()',
    '[disabled]': 'isDisabled()',
    '(input)': 'onInput($event)',
  },
})
export class NxaToolApprovalQuestionText {
  /** Disables the field on top of the request state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly state = injectToolApproval();
  private readonly question = injectQuestion();
  protected readonly value = computed(() => this.state.typedAnswer(this.question().id));
  protected readonly isDisabled = computed(
    () => this.disabled() || this.state.locked() || !questionAcceptsText(this.question()),
  );

  protected onInput(event: Event) {
    this.state.setTypedAnswer(this.question().id, (event.target as HTMLTextAreaElement).value);
  }
}

/** A button that sends the answers of every question. Disabled until each question has one. */
@Directive({
  selector: 'button[nxaToolApprovalSubmitAnswers]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaToolApprovalSubmitAnswers {
  /** Disables the button on top of the request state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly state = injectToolApproval();
  protected readonly isDisabled = computed(
    () => this.disabled() || this.state.locked() || !this.state.questionsComplete(),
  );

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    this.state.submitAnswers();
  }
}
