import { Directive, TemplateRef, ViewContainerRef, computed, inject, input } from '@angular/core';
import type { MessageState } from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';
import { injectMessage, injectMessageUi } from '../scopes';
import { conditionalView } from './conditional-view';

/**
 * The conditions of `*nxaMessageIf`. Every condition given must hold; `true` asks for the trait
 * and `false` for its absence, and a missing condition is not checked.
 */
export interface NxaMessageIfConditions {
  user?: boolean;
  assistant?: boolean;
  system?: boolean;
  /** `true`: the message has at least two branches. `false` is not checked. */
  hasBranches?: boolean;
  /** The message was just copied (`injectMessageUi().isCopied`). */
  copied?: boolean;
  /** `true`: the message is the last one or the pointer is over it. `false` is not checked. */
  lastOrHover?: boolean;
  last?: boolean;
  /** The message is being spoken. */
  speaking?: boolean;
  /** A user message with attachments. */
  hasAttachments?: boolean;
  /** The message has at least one content part. */
  hasContent?: boolean;
  /** The feedback submitted for the message, `null` for none. */
  submittedFeedback?: 'positive' | 'negative' | null;
}

const matches = (
  when: NxaMessageIfConditions,
  s: MessageState,
  isHovering: boolean,
  isCopied: boolean,
) => {
  const { role } = s;
  if (when.hasBranches === true && s.branchCount < 2) return false;

  if (when.user !== undefined && when.user !== (role === 'user')) return false;
  if (when.assistant !== undefined && when.assistant !== (role === 'assistant')) return false;
  if (when.system !== undefined && when.system !== (role === 'system')) return false;

  if (when.lastOrHover === true && !isHovering && !s.isLast) return false;
  if (when.last !== undefined && when.last !== s.isLast) return false;

  if (when.copied !== undefined && when.copied !== isCopied) return false;
  if (when.speaking !== undefined && when.speaking !== (s.speech != null)) return false;

  const hasAttachments = role === 'user' && !!s.attachments?.length;
  if (when.hasAttachments !== undefined && when.hasAttachments !== hasAttachments) return false;
  if (when.hasContent !== undefined && when.hasContent !== s.content.length > 0) return false;

  if (
    when.submittedFeedback !== undefined &&
    (s.metadata.submittedFeedback?.type ?? null) !== when.submittedFeedback
  )
    return false;

  return true;
};

/**
 * Renders its template while the nearest message meets every condition given, and the `else`
 * template otherwise.
 *
 * @example
 * ```html
 * <div *nxaMessageIf="{ assistant: true, last: true }">...</div>
 * <span *nxaMessageIf="{ copied: true }; else copy">Copied</span>
 * ```
 */
@Directive({ selector: '[nxaMessageIf]' })
export class NxaMessageIf {
  readonly nxaMessageIf = input.required<NxaMessageIfConditions>();
  readonly nxaMessageIfElse = input<TemplateRef<unknown> | null>(null);

  private readonly state = fromRuntime(injectMessage());
  private readonly ui = injectMessageUi();

  constructor() {
    conditionalView(
      inject(ViewContainerRef),
      inject(TemplateRef),
      computed(() =>
        matches(this.nxaMessageIf(), this.state(), this.ui.isHovering(), this.ui.isCopied()),
      ),
      this.nxaMessageIfElse,
    );
  }
}
