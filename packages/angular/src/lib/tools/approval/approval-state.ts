import {
  InjectionToken,
  Signal,
  WritableSignal,
  computed,
  linkedSignal,
  signal,
} from '@angular/core';
import {
  toolApprovalAcceptsText,
  type ThreadRuntime,
  type ToolApprovalAnswer,
  type ToolApprovalOption,
  type ToolApprovalQuestion,
  type ToolApprovalResponse,
} from '@ngx-assistant/engine';
import { fromRuntime } from '../../from-runtime';
import type { ToolCallContext, ToolCallApproval } from '../tool-call';

const KNOWN_KINDS = new Set(['allow-once', 'allow-always', 'reject-once', 'reject-always']);
const isKnownKind = (kind: string) => KNOWN_KINDS.has(kind);
const isAllowKind = (kind: string) => kind === 'allow-once' || kind === 'allow-always';

/** Where an approval request stands. */
export type ToolApprovalOutcome = 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired';

/** A settled request: what was decided, for a receipt. */
export interface ToolApprovalReceipt {
  /** `allowed` and `refused` record a decision; `closed` a request that ended without one. */
  readonly outcome: 'allowed' | 'refused' | 'closed';
  /** Whether the request asked a question (or offered a custom option), so it was answered, not allowed. */
  readonly answered: boolean;
  /** Whether a policy decided instead of the user. */
  readonly automatic: boolean;
  /** The option chosen, when the request offered options. */
  readonly option: ToolApprovalOption | undefined;
  /** The typed answer and the reason recorded with the decision, without duplicates. */
  readonly notes: readonly string[];
  /** The recorded answers of a `questions` request, in the order of its questions. */
  readonly answers: readonly ToolApprovalReceiptAnswer[];
}

/** The recorded answer to one question. */
export interface ToolApprovalReceiptAnswer {
  readonly question: ToolApprovalQuestion;
  /** The chosen options, as the question declares them; an unknown id gives a bare option. */
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly text: string | undefined;
}

/**
 * Whether the request asks a question rather than gating an action: a question is refused only
 * when it declares itself `dismissible`.
 */
export const isToolApprovalQuestion = (approval: ToolCallApproval | undefined) =>
  approval?.display === 'select' ||
  approval?.display === 'text' ||
  approval?.display === 'questions';

const isSettled = (approval: ToolCallApproval) =>
  approval.approved !== undefined || approval.resolution !== undefined;

// An open request waits for an answer only while its call requires action: a cancelled run
// leaves it open but unanswerable.
const outcomeOf = (
  approval: ToolCallApproval | undefined,
  requiresAction: boolean,
): ToolApprovalOutcome | null => {
  if (!approval) return null;
  if (approval.resolution !== undefined) return approval.resolution;
  if (approval.approved === undefined) return requiresAction ? 'pending' : null;
  return approval.approved ? 'approved' : 'denied';
};

const answersOf = (approval: ToolCallApproval): ToolApprovalReceiptAnswer[] => {
  const answers = approval.answers;
  if (!answers) return [];
  return (approval.questions ?? []).flatMap((question) => {
    // Own keys only: a question id such as `__proto__` must not read the prototype.
    const answer = Object.hasOwn(answers, question.id) ? answers[question.id] : undefined;
    const options = (answer?.optionIds ?? []).map(
      (id) => question.options?.find((option) => option.id === id) ?? { id, label: id },
    );
    const text = answer?.text?.trim() ? answer.text : undefined;
    return options.length === 0 && text === undefined ? [] : [{ question, options, text }];
  });
};

const receiptOf = (approval: ToolCallApproval | undefined): ToolApprovalReceipt | null => {
  if (!approval || !isSettled(approval)) return null;
  const option =
    approval.optionId === undefined
      ? undefined
      : approval.options?.find((candidate) => candidate.id === approval.optionId);
  const notes = [
    ...new Set(
      [approval.text, approval.reason].filter(
        (value): value is string => typeof value === 'string' && value !== '',
      ),
    ),
  ];
  const automatic = approval.isAutomatic === true;
  if (approval.resolution !== undefined) {
    return { outcome: 'closed', answered: false, automatic, option: undefined, notes, answers: [] };
  }
  return {
    outcome: approval.approved ? 'allowed' : 'refused',
    answered:
      isToolApprovalQuestion(approval) || (option !== undefined && !isKnownKind(option.kind)),
    automatic,
    option,
    notes,
    answers: answersOf(approval),
  };
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The approval request of one tool call and the local state of the controls that answer it: the
 * typed draft, the option awaiting confirmation, the questionnaire answers, the submission lock and
 * the last error. The local state belongs to the pending request: it starts afresh when another
 * request arrives or the request settles.
 */
export class ToolApprovalState {
  /** The request, pending or settled. */
  readonly approval: Signal<ToolCallApproval | undefined>;
  /**
   * `pending` while the call requires action, then `approved`, `denied`, `cancelled` or
   * `expired`; `null` without a request, or with an open one that cannot be answered now.
   */
  readonly outcome: Signal<ToolApprovalOutcome | null>;
  /** Whether the request waits for an answer. */
  readonly pending: Signal<boolean>;
  /** What was decided, once the request settled. */
  readonly receipt: Signal<ToolApprovalReceipt | null>;
  /** How the request asks to be presented: `decision` unless it says otherwise. */
  readonly display: Signal<NonNullable<ToolCallApproval['display']>>;
  /** Whether the request asks a question rather than for a decision. */
  readonly isQuestion: Signal<boolean>;
  /** Whether a question may be dismissed without an answer. */
  readonly dismissible: Signal<boolean>;
  /** Whether a typed answer is accepted, alone or beside a decision. */
  readonly acceptsText: Signal<boolean>;
  /** The declared options: the allowing ones first, then custom kinds, then the refusing ones. */
  readonly options: Signal<readonly ToolApprovalOption[]>;
  /** The questions of a `questions` request. */
  readonly questions: Signal<readonly ToolApprovalQuestion[]>;
  /** Whether the thread can answer at all (it supports it, and no voice session holds it). */
  readonly canAnswer: Signal<boolean>;

  /** The typed answer, or the note sent with a decision. */
  readonly draft: WritableSignal<string>;
  /** The option whose confirmation step is shown, if any. */
  readonly confirming: Signal<ToolApprovalOption | undefined>;
  /** Whether an answer is on its way; the controls stay locked until the request settles. */
  readonly submitting: Signal<boolean>;
  /** Why the last answer was refused, until the next attempt. */
  readonly error: Signal<string | null>;
  /** Whether the controls are inactive: no pending request, an answer on its way, or no way to answer. */
  readonly locked: Signal<boolean>;
  /** Whether every question has an answer. */
  readonly questionsComplete: Signal<boolean>;
  /** Whether the typed draft can be sent as the answer: a question that takes a typed answer. */
  readonly canSubmitText: Signal<boolean>;

  private readonly requestKey: Signal<string | null>;
  private readonly confirmingId: WritableSignal<string | null>;
  private readonly submitted: WritableSignal<boolean>;
  private readonly failure: WritableSignal<string | null>;
  private readonly selected: WritableSignal<ReadonlyMap<string, readonly string[]>>;
  private readonly typed: WritableSignal<ReadonlyMap<string, string>>;

  constructor(
    private readonly tool: ToolCallContext,
    thread: ThreadRuntime | null,
  ) {
    this.approval = tool.approval;
    this.outcome = computed(() =>
      outcomeOf(this.approval(), tool.status().type === 'requires-action'),
    );
    this.pending = computed(() => this.outcome() === 'pending');
    this.receipt = computed(() => receiptOf(this.approval()));
    this.display = computed(() => this.approval()?.display ?? 'decision');
    this.isQuestion = computed(() => isToolApprovalQuestion(this.approval()));
    this.dismissible = computed(() => this.isQuestion() && this.approval()?.dismissible === true);
    this.acceptsText = computed(() => {
      const approval = this.approval();
      return approval !== undefined && toolApprovalAcceptsText(approval);
    });
    this.options = computed(() => {
      const options = this.approval()?.options ?? [];
      return [
        ...options.filter((option) => isAllowKind(option.kind)),
        ...options.filter((option) => !isKnownKind(option.kind)),
        ...options.filter((option) => isKnownKind(option.kind) && !isAllowKind(option.kind)),
      ];
    });
    this.questions = computed(() => this.approval()?.questions ?? []);
    this.canSubmitText = computed(() => this.isQuestion() && this.acceptsText());
    const answerable = thread
      ? fromRuntime(thread, (s) => s.capabilities.answerToolCall && s.voice === undefined)
      : signal(true);
    this.canAnswer = answerable;

    // The pending request's id, or null: the local state follows it.
    this.requestKey = computed(() => (this.pending() ? (this.approval()?.id ?? null) : null));
    const fresh = <T>(value: () => T) =>
      linkedSignal<string | null, T>({ source: this.requestKey, computation: value });
    this.draft = fresh(() => '');
    this.confirmingId = fresh<string | null>(() => null);
    this.submitted = fresh(() => false);
    this.failure = fresh<string | null>(() => null);
    this.selected = fresh<ReadonlyMap<string, readonly string[]>>(() => new Map());
    this.typed = fresh<ReadonlyMap<string, string>>(() => new Map());

    this.confirming = computed(() => {
      const id = this.confirmingId();
      return id === null ? undefined : this.options().find((option) => option.id === id);
    });
    this.submitting = this.submitted.asReadonly();
    this.error = this.failure.asReadonly();
    this.locked = computed(() => !this.pending() || this.submitted() || !this.canAnswer());
    this.questionsComplete = computed(() => {
      const questions = this.questions();
      return (
        questions.length > 0 &&
        questions.every((question) => {
          const answer = this.answerOf(question.id);
          return answer.optionIds !== undefined || answer.text !== undefined;
        })
      );
    });
  }

  /**
   * Allows or denies a decision, with the typed draft as a note when there is one. A question is
   * answered, or dismissed, instead.
   */
  respond(approved: boolean) {
    if (this.locked() || this.isQuestion()) return;
    this.submit({ approved, ...this.note() });
  }

  /** Picks an option: shows its confirmation step when it asks for one, otherwise answers with it. */
  choose(option: ToolApprovalOption) {
    if (this.locked()) return;
    if (option.confirm) this.confirmingId.set(option.id);
    else this.respondWithOption(option);
  }

  /** Answers with the option awaiting confirmation. */
  confirm() {
    const option = this.confirming();
    if (option) this.respondWithOption(option);
  }

  /** Leaves the confirmation step without answering. */
  cancelConfirm() {
    this.confirmingId.set(null);
  }

  /**
   * Sends the typed draft as the answer to a question, empty included: it is the answer the user
   * gave. On a decision the draft travels as the note of `respond`.
   */
  submitText() {
    if (this.locked() || !this.canSubmitText()) return;
    this.submit({ text: this.draft() });
  }

  /** Dismisses a question that accepts it; the typed draft does not travel with a dismissal. */
  dismiss() {
    if (this.locked() || !this.dismissible()) return;
    this.submit({ approved: false });
  }

  /** Whether an option of a question is chosen. */
  isChosen(questionId: string, optionId: string): boolean {
    return (this.selected().get(questionId) ?? []).includes(optionId);
  }

  /** Chooses or clears an option of a question; a single-choice question keeps one. */
  toggle(questionId: string, optionId: string) {
    if (this.locked()) return;
    const question = this.questions().find((candidate) => candidate.id === questionId);
    if (!question) return;
    const chosen = this.selected().get(questionId) ?? [];
    const next = chosen.includes(optionId)
      ? chosen.filter((id) => id !== optionId)
      : question.multiple
        ? [...chosen, optionId]
        : [optionId];
    this.selected.set(new Map(this.selected()).set(questionId, next));
  }

  /** The typed answer to a question. */
  typedAnswer(questionId: string): string {
    return this.typed().get(questionId) ?? '';
  }

  /** Sets the typed answer to a question. */
  setTypedAnswer(questionId: string, text: string) {
    this.typed.set(new Map(this.typed()).set(questionId, text));
  }

  /** The answer to a question as it would be sent. */
  answerOf(questionId: string): ToolApprovalAnswer {
    const optionIds = this.selected().get(questionId) ?? [];
    const draft = this.typed().get(questionId);
    const text = draft?.trim() ? draft : undefined;
    return {
      ...(optionIds.length > 0 && { optionIds }),
      ...(text !== undefined && { text }),
    };
  }

  /** Sends the answers of every question, once each has one. */
  submitAnswers() {
    if (this.locked() || !this.questionsComplete()) return;
    const answers = Object.fromEntries(
      this.questions().map((question) => [question.id, this.answerOf(question.id)]),
    );
    this.submit({ answers });
  }

  // The typed draft travels with a decision only when it says something.
  private note(): { text?: string } {
    const draft = this.draft();
    return draft.trim() ? { text: draft } : {};
  }

  private respondWithOption(option: ToolApprovalOption) {
    if (this.locked()) return;
    this.confirmingId.set(null);
    const note = this.note();
    // A custom kind has no decision class to derive: picking it is an answer, so it approves.
    this.submit(
      isKnownKind(option.kind)
        ? { optionId: option.id, ...note }
        : { optionId: option.id, approved: true, ...note },
    );
  }

  // A refused answer leaves the request open: the controls come back with the reason. A refusal
  // that arrives after another request took over belongs to the old one and is dropped.
  private submit(response: ToolApprovalResponse) {
    const key = this.requestKey();
    this.submitted.set(true);
    this.failure.set(null);
    const fail = (error: unknown) => {
      if (this.requestKey() !== key) return;
      this.submitted.set(false);
      this.failure.set(messageOf(error));
    };
    try {
      this.tool.respondToApproval(response).catch(fail);
    } catch (error) {
      fail(error);
    }
  }
}

export const NXA_TOOL_APPROVAL = new InjectionToken<ToolApprovalState | null>('NXA_TOOL_APPROVAL');
