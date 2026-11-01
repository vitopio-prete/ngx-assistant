import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  NxaToolApprovalApprove,
  NxaToolApprovalConfirm,
  NxaToolApprovalConfirmCancel,
  NxaToolApprovalDeny,
  NxaToolApprovalDismiss,
  NxaToolApprovalOption,
  NxaToolApprovalQuestionOption,
  NxaToolApprovalQuestionText,
  NxaToolApprovalQuestions,
  NxaToolApprovalRoot,
  NxaToolApprovalSubmitAnswers,
  NxaToolApprovalSubmitText,
  NxaToolApprovalText,
  type ToolApprovalReceipt,
  type ToolCallApproval,
} from '@ngx-assistant/angular';
import type { ToolApprovalOption } from '@ngx-assistant/engine';
import { NxaIcon, type NxaIconName } from '../icons';

const KIND_LABELS: Record<string, string> = {
  'allow-once': 'Allow',
  'allow-always': 'Always allow',
  'reject-once': 'Deny',
  'reject-always': 'Always deny',
};

const isAllowKind = (kind: string) => kind === 'allow-once' || kind === 'allow-always';

/** The label of an option: its own, the default of its kind, or its id. */
export const approvalOptionLabel = (option: ToolApprovalOption) =>
  option.label ?? (Object.hasOwn(KIND_LABELS, option.kind) ? KIND_LABELS[option.kind] : option.id);

const BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:pointer-events-none disabled:opacity-50';
const PRIMARY = `${BUTTON} bg-nxa-primary text-nxa-primary-foreground hover:opacity-90`;
const OUTLINE = `${BUTTON} border border-nxa-border bg-nxa-background hover:bg-nxa-accent hover:text-nxa-accent-foreground`;
const TEXTAREA =
  'min-h-16 w-full resize-none rounded-lg border border-nxa-border bg-nxa-background px-2.5 py-1.5 text-sm outline-none placeholder:text-nxa-muted-foreground focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:opacity-50';

/**
 * The approval request of the nearest tool call: its controls while it waits (a decision, the
 * declared options with their confirmation step, a typed answer or a questionnaire), then a
 * receipt of what was decided.
 */
@Component({
  selector: 'nxa-tool-approval',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaIcon,
    NxaToolApprovalRoot,
    NxaToolApprovalApprove,
    NxaToolApprovalDeny,
    NxaToolApprovalOption,
    NxaToolApprovalConfirm,
    NxaToolApprovalConfirmCancel,
    NxaToolApprovalText,
    NxaToolApprovalSubmitText,
    NxaToolApprovalDismiss,
    NxaToolApprovalQuestions,
    NxaToolApprovalQuestionOption,
    NxaToolApprovalQuestionText,
    NxaToolApprovalSubmitAnswers,
  ],
  template: `
    <div nxaToolApprovalRoot #root="nxaToolApprovalRoot" class="flex flex-col gap-2 pt-1">
      @let state = root.state;
      @let approval = state.approval();
      @if (state.receipt(); as receipt) {
        <div
          data-slot="tool-approval-receipt"
          [attr.data-outcome]="receipt.outcome"
          class="flex flex-col gap-1.5"
        >
          @if (approval?.prompt) {
            <p class="whitespace-pre-line text-nxa-muted-foreground">{{ approval?.prompt }}</p>
          }
          <p class="flex items-center gap-1.5">
            <nxa-icon [name]="receiptIcon(receipt)" class="size-3.5 text-nxa-muted-foreground" />
            <span class="font-medium">{{ receiptLabel(receipt, approval) }}</span>
            @if (receipt.option; as option) {
              <span class="text-nxa-muted-foreground">· {{ optionLabel(option) }}</span>
            } @else if (approval?.optionId) {
              <span class="text-nxa-muted-foreground">· {{ approval?.optionId }}</span>
            }
          </p>
          @for (answer of receipt.answers; track answer.question.id) {
            <p class="whitespace-pre-line">
              <span class="text-nxa-muted-foreground">{{
                answer.question.header ?? answer.question.prompt
              }}</span>
              · {{ answerLabels(answer.options, answer.text) }}
            </p>
          }
          @for (note of receipt.notes; track note) {
            <p class="whitespace-pre-line text-nxa-muted-foreground">{{ note }}</p>
          }
        </div>
      } @else if (state.pending()) {
        @if (approval?.prompt) {
          <p class="whitespace-pre-line">{{ approval?.prompt }}</p>
        }
        @if (!state.canAnswer()) {
          <!-- The thread cannot answer: the request is shown, without controls. -->
        } @else if (state.confirming(); as option) {
          <div data-slot="tool-approval-confirm" class="flex flex-col gap-2">
            <p class="font-semibold">{{ confirmTitle(option) }}</p>
            @if (confirmDescription(option); as description) {
              <p class="whitespace-pre-line text-nxa-muted-foreground">{{ description }}</p>
            }
            @if (option.grants?.length) {
              <ul class="flex flex-col gap-1">
                @for (grant of option.grants; track grant) {
                  <li>
                    <code class="rounded bg-nxa-muted px-1.5 py-0.5 text-xs">{{ grant }}</code>
                  </li>
                }
              </ul>
            }
            <div class="flex items-center gap-2">
              <button nxaToolApprovalConfirm [class]="primary">Confirm</button>
              <button nxaToolApprovalConfirmCancel [class]="outline">Back</button>
            </div>
          </div>
        } @else if (state.display() === 'questions') {
          <div data-slot="tool-approval-questions" class="flex flex-col gap-3">
            <div
              *nxaToolApprovalQuestions="let question"
              role="group"
              [attr.aria-label]="question().prompt"
              class="flex flex-col gap-2"
            >
              <p class="whitespace-pre-line">
                @if (question().header) {
                  <span class="me-1.5 text-xs font-medium text-nxa-muted-foreground uppercase">{{
                    question().header
                  }}</span>
                }
                {{ question().prompt }}
              </p>
              @if (question().options?.length) {
                <div
                  class="flex gap-2"
                  [class]="
                    described(question()) ? 'flex-col items-stretch' : 'flex-wrap items-center'
                  "
                >
                  @for (option of question().options; track option.id) {
                    <button
                      [nxaToolApprovalQuestionOption]="option.id"
                      [class]="
                        (state.isChosen(question().id, option.id) ? primary : outline) +
                        (option.description ? ' flex-col items-start text-start' : '')
                      "
                    >
                      <span>{{ option.label }}</span>
                      @if (option.description) {
                        <span class="text-xs font-normal opacity-80">{{ option.description }}</span>
                      }
                    </button>
                  }
                </div>
              }
              @if (acceptsText(question())) {
                <textarea
                  nxaToolApprovalQuestionText
                  [attr.aria-label]="question().prompt"
                  [placeholder]="
                    question().options?.length ? 'Or type an answer' : 'Type your answer'
                  "
                  [class]="textarea"
                ></textarea>
              }
            </div>
            <div class="flex items-center gap-2">
              <button nxaToolApprovalSubmitAnswers [class]="primary">Send</button>
              @if (state.dismissible()) {
                <button nxaToolApprovalDismiss [class]="outline">Dismiss</button>
              }
            </div>
          </div>
        } @else {
          <div data-slot="tool-approval-controls" class="flex flex-col gap-2">
            @if (state.options().length > 0) {
              <div class="flex flex-wrap items-center gap-2">
                @for (option of state.options(); track option.id; let first = $first) {
                  <button
                    [nxaToolApprovalOption]="option"
                    [class]="first && isAllow(option) ? primary : outline"
                  >
                    {{ optionLabel(option) }}
                  </button>
                }
                @if (!hasRejectOption(state.options()) && !state.isQuestion()) {
                  <button nxaToolApprovalDeny [class]="outline">Deny</button>
                }
                @if (!state.acceptsText() && state.dismissible()) {
                  <button nxaToolApprovalDismiss [class]="outline">Dismiss</button>
                }
              </div>
            } @else if (!state.isQuestion()) {
              <div class="flex items-center gap-2">
                <button nxaToolApprovalApprove [class]="primary">Allow</button>
                <button nxaToolApprovalDeny [class]="outline">Deny</button>
              </div>
            }
            @if (state.acceptsText()) {
              <div class="flex flex-col items-start gap-2">
                <textarea
                  nxaToolApprovalText
                  [attr.aria-label]="state.isQuestion() ? (approval?.prompt ?? 'Answer') : 'Note'"
                  [placeholder]="
                    state.isQuestion() ? 'Type your answer' : 'Add a note to your decision'
                  "
                  [class]="textarea"
                ></textarea>
                @if (state.isQuestion()) {
                  <div class="flex items-center gap-2">
                    <button nxaToolApprovalSubmitText [class]="primary">Send</button>
                    @if (state.dismissible()) {
                      <button nxaToolApprovalDismiss [class]="outline">Dismiss</button>
                    }
                  </div>
                }
              </div>
            } @else if (state.isQuestion() && state.options().length === 0 && state.dismissible()) {
              <div class="flex items-center gap-2">
                <button nxaToolApprovalDismiss [class]="outline">Dismiss</button>
              </div>
            }
          </div>
        }
        @if (state.error(); as error) {
          <p role="alert" class="text-xs whitespace-pre-line text-nxa-destructive">{{ error }}</p>
        }
      }
    </div>
  `,
})
export class NxaToolApproval {
  protected readonly primary = PRIMARY;
  protected readonly outline = OUTLINE;
  protected readonly textarea = TEXTAREA;
  protected readonly optionLabel = approvalOptionLabel;

  protected isAllow(option: ToolApprovalOption) {
    return isAllowKind(option.kind);
  }

  protected hasRejectOption(options: readonly ToolApprovalOption[]) {
    return options.some(
      (option) => option.kind === 'reject-once' || option.kind === 'reject-always',
    );
  }

  protected described(question: { options?: readonly { description?: string }[] }) {
    return question.options?.some((option) => option.description) ?? false;
  }

  protected acceptsText(question: { options?: readonly unknown[]; allowFreeform?: boolean }) {
    return !question.options?.length || question.allowFreeform === true;
  }

  protected confirmTitle(option: ToolApprovalOption) {
    return (
      (typeof option.confirm === 'object' && option.confirm.title) ||
      `${approvalOptionLabel(option)}?`
    );
  }

  protected confirmDescription(option: ToolApprovalOption) {
    return (typeof option.confirm === 'object' && option.confirm.description) || option.description;
  }

  protected receiptIcon(receipt: ToolApprovalReceipt): NxaIconName {
    return receipt.outcome === 'allowed'
      ? 'check'
      : receipt.outcome === 'refused'
        ? 'circle-x'
        : 'circle-minus';
  }

  protected receiptLabel(receipt: ToolApprovalReceipt, approval: ToolCallApproval | undefined) {
    if (receipt.outcome === 'closed') {
      return approval?.resolution === 'cancelled'
        ? 'Cancelled before a decision'
        : 'Expired before a decision';
    }
    const automatic = receipt.automatic ? ' automatically' : '';
    if (receipt.outcome === 'allowed')
      return `${receipt.answered ? 'Answered' : 'Allowed'}${automatic}`;
    return `${receipt.answered ? 'Dismissed' : 'Denied'}${automatic}`;
  }

  protected answerLabels(options: readonly { label: string }[], text: string | undefined) {
    return [...options.map((option) => option.label), ...(text ? [text] : [])].join(', ');
  }
}
