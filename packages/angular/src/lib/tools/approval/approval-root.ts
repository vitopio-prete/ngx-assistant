import { Directive, inject } from '@angular/core';
import { injectThread } from '../../scopes';
import { injectToolCall } from '../tool-call';
import { NXA_TOOL_APPROVAL, ToolApprovalState } from './approval-state';

/**
 * The root of the controls that answer the approval request of the nearest tool call. It holds
 * the request and the local state of its controls (`state`, also `injectToolApproval()`), which
 * starts afresh when another request arrives or the request settles.
 *
 * Its host carries `data-nxa-approval` (`pending`, `approved`, `denied`, `cancelled` or
 * `expired`, absent without a request), `data-nxa-display`, and while an answer is on its way
 * `data-nxa-submitting` and `aria-busy`. `data-nxa-error` is set while the last answer stands
 * refused, and `data-nxa-confirming` while an option waits for its confirmation.
 *
 * @example
 * ```html
 * <div nxaToolApprovalRoot #approval="nxaToolApprovalRoot">
 *   @if (approval.state.pending()) {
 *     <button nxaToolApprovalApprove>Allow</button>
 *     <button nxaToolApprovalDeny>Deny</button>
 *   } @else if (approval.state.receipt(); as receipt) {
 *     {{ receipt.outcome }}
 *   }
 * </div>
 * ```
 */
@Directive({
  selector: '[nxaToolApprovalRoot]',
  exportAs: 'nxaToolApprovalRoot',
  providers: [
    {
      provide: NXA_TOOL_APPROVAL,
      useFactory: () => new ToolApprovalState(injectToolCall(), injectThread({ optional: true })),
    },
  ],
  host: {
    '[attr.data-nxa-approval]': 'state.outcome()',
    '[attr.data-nxa-display]': 'state.approval() ? state.display() : null',
    '[attr.data-nxa-submitting]': "state.submitting() ? '' : null",
    '[attr.aria-busy]': "state.submitting() ? 'true' : null",
    '[attr.data-nxa-error]': "state.error() !== null ? '' : null",
    '[attr.data-nxa-confirming]': "state.confirming() ? '' : null",
  },
})
export class NxaToolApprovalRoot {
  /** The request and the state of its controls. */
  readonly state = inject(NXA_TOOL_APPROVAL)!;
}

/** The approval state of the nearest `nxaToolApprovalRoot`. */
export function injectToolApproval(options: { optional: true }): ToolApprovalState | null;
export function injectToolApproval(options?: { optional?: false }): ToolApprovalState;
export function injectToolApproval(options?: { optional?: boolean }): ToolApprovalState | null {
  const state = inject(NXA_TOOL_APPROVAL, { optional: true }) ?? null;
  if (state === null && !options?.optional) {
    throw new Error(
      '[ngx-assistant] No tool approval here: call it inside an element with nxaToolApprovalRoot.',
    );
  }
  return state;
}
