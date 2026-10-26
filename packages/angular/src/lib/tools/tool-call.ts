import { InjectionToken, Injector, Signal, computed, inject } from '@angular/core';
import type {
  MessagePartRuntime,
  ToolApprovalResponse,
  ToolCallMessagePart,
  ToolCallMessagePartStatus,
  Unstable_ToolInteractionInput,
} from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';

/** The default type of tool call arguments: a JSON object. */
export type ToolCallArgs = ToolCallMessagePart['args'];

/** The state of a `tool-call` part, with its status. */
export type ToolCallPartState<TArgs = ToolCallArgs, TResult = unknown> = ToolCallMessagePart<
  TArgs,
  TResult
> & { readonly status: ToolCallMessagePartStatus };

/** The approval request of a tool call, as the part carries it. */
export type ToolCallApproval = NonNullable<ToolCallMessagePart['approval']>;

/**
 * One tool call, for the component that renders it: its state as signals, and the actions that
 * answer it. Provided by every `tool-call` part scope, so a registered tool UI and the template of
 * `*nxaMessageParts` both reach it with `injectToolCall()`.
 */
export interface ToolCallContext<TArgs = ToolCallArgs, TResult = unknown> {
  /** The whole part, live. */
  readonly part: Signal<ToolCallPartState<TArgs, TResult>>;
  /** The arguments. While the model streams them, a partial parse. */
  readonly args: Signal<TArgs>;
  /** The result, once the tool returned one. */
  readonly result: Signal<TResult | undefined>;
  /** `running`, `requires-action`, `complete` or `incomplete`. */
  readonly status: Signal<ToolCallMessagePartStatus>;
  /** The approval request, if the call is gated by one, pending or settled. */
  readonly approval: Signal<ToolCallApproval | undefined>;
  /** Completes the call with a result, as a human-in-the-loop tool does. */
  addResult(result: unknown): void;
  /** Resumes a call that is waiting on a human input (`interrupt`), with the answer. */
  resume(payload: unknown): void;
  /** Answers the pending approval request; rejects when the runtime refuses the answer. */
  respondToApproval(response: ToolApprovalResponse): Promise<void>;
  /**
   * Records what the user did in the tool UI, stored with the call.
   *
   * @deprecated Experimental; the API may change in any release.
   */
  unstable_recordInteraction(input: Unstable_ToolInteractionInput): Promise<void>;
}

export const NXA_TOOL_CALL = new InjectionToken<ToolCallContext | null>('NXA_TOOL_CALL');

const selectFrom = <S, T>(source: Signal<S>, select: (state: S) => T): Signal<T> =>
  computed(() => select(source()));

/**
 * The tool call of a `tool-call` part runtime, or `null` for any other part. Its signals live as
 * long as `injector`.
 */
export function createToolCall(
  part: MessagePartRuntime,
  injector: Injector,
): ToolCallContext | null {
  if (part.getState().type !== 'tool-call') return null;
  const state = fromRuntime(part, (s) => s as ToolCallPartState, { injector });
  return {
    part: state,
    args: selectFrom(state, (s) => s.args),
    result: selectFrom(state, (s) => s.result),
    status: selectFrom(state, (s) => s.status),
    approval: selectFrom(state, (s) => s.approval),
    addResult: (result) => part.addToolResult(result),
    resume: (payload) => part.resumeToolCall(payload),
    // A response the runtime refuses up front rejects too, like one the host refuses later.
    respondToApproval: async (response) => part.respondToToolApproval(response),
    unstable_recordInteraction: async (input) => {
      if (!part.unstable_recordInteraction) {
        throw new Error('[ngx-assistant] This runtime does not record tool interactions.');
      }
      await part.unstable_recordInteraction(input);
    },
  };
}

/**
 * The nearest tool call. Call it in a component or directive rendered for a `tool-call` part: a
 * tool UI registered with `provideToolUi(...)`, or the template of `*nxaMessageParts`.
 *
 * @example
 * ```ts
 * readonly tool = injectToolCall<{ city: string }, string>();
 * readonly city = computed(() => this.tool.args().city);
 * ```
 */
export function injectToolCall<TArgs = ToolCallArgs, TResult = unknown>(options: {
  optional: true;
}): ToolCallContext<TArgs, TResult> | null;
export function injectToolCall<TArgs = ToolCallArgs, TResult = unknown>(options?: {
  optional?: false;
}): ToolCallContext<TArgs, TResult>;
export function injectToolCall(options?: { optional?: boolean }): ToolCallContext | null {
  const tool = inject(NXA_TOOL_CALL, { optional: true }) ?? null;
  if (tool === null && !options?.optional) {
    throw new Error(
      '[ngx-assistant] No tool call scope here: call it inside the scope of a tool-call part.',
    );
  }
  return tool;
}
