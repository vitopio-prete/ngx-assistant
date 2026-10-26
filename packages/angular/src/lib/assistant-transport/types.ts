import type { Signal } from '@angular/core';
import type {
  AttachmentAdapter,
  LanguageModelConfig,
  LanguageModelV1CallSettings,
  ThreadMessage,
  ToolExecutionStatus,
  UserCommands,
} from '@ngx-assistant/engine';
import type { ToolModelContentPart } from 'assistant-stream';
import type { ReadonlyJSONValue } from 'assistant-stream/utils';

export interface TextPart {
  readonly type: 'text';
  readonly text: string;
}

export interface ImagePart {
  readonly type: 'image';
  readonly image: string;
}

export type UserMessagePart = TextPart | ImagePart;

export interface UserMessage {
  readonly role: 'user';
  readonly id?: string;
  readonly parts: readonly UserMessagePart[];
}

export interface AssistantMessage {
  readonly role: 'assistant';
  readonly parts: readonly TextPart[];
}

/** Adds a message to the conversation on the server. */
export interface AddMessageCommand {
  readonly type: 'add-message';
  readonly message: UserMessage | AssistantMessage;
  readonly parentId: string | null;
  readonly sourceId: string | null;
}

/** Hands the server the result of a tool call made in the browser or answered by the user. */
export interface AddToolResultCommand {
  readonly type: 'add-tool-result';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly result: ReadonlyJSONValue;
  readonly isError: boolean;
  readonly artifact?: ReadonlyJSONValue;
  readonly modelContent?: readonly ToolModelContentPart[];
}

/**
 * A command sent to the server. Custom commands are declared with module augmentation of
 * `Assistant.Commands` in `@ngx-assistant/engine`.
 */
export type AssistantTransportCommand = AddMessageCommand | AddToolResultCommand | UserCommands;

/** What the converter makes of the agent state: the thread the UI shows. */
export interface AssistantTransportState {
  readonly messages: readonly ThreadMessage[];
  readonly state?: ReadonlyJSONValue;
  readonly isRunning: boolean;
}

export interface AssistantTransportConnectionMetadata {
  /** Commands not yet confirmed by the server: in transit first, then queued. */
  pendingCommands: AssistantTransportCommand[];
  /** Whether a request is running. */
  isSending: boolean;
  /** Execution status of the frontend tools, by tool call id. */
  toolStatuses: Record<string, ToolExecutionStatus>;
}

export type AssistantTransportStateConverter<T> = (
  state: T,
  connectionMetadata: AssistantTransportConnectionMetadata,
) => AssistantTransportState;

export interface CommandQueueState {
  queued: AssistantTransportCommand[];
  inTransit: AssistantTransportCommand[];
}

export type HeadersValue = Record<string, string> | Headers;

export type AssistantTransportProtocol = 'data-stream' | 'assistant-transport';

export interface SendCommandsRequestBody {
  commands: AssistantTransportCommand[];
  /** Absent on a resume with `resumeStateApi`; the server replays from its retained snapshot. */
  state?: unknown;
  runId?: string;
  system: string | undefined;
  tools: Record<string, unknown> | undefined;
  callSettings: LanguageModelV1CallSettings | undefined;
  config: LanguageModelConfig | undefined;
  /** Remote id of the thread; absent only when resuming a thread that has none. */
  threadId?: string;
  parentId?: string | null;
  // `callSettings` and `config` fields are also spread at the top level (e.g. `body.modelName`).
  // Prefer the nested objects.
  [key: string]: unknown;
}

export interface AssistantTransportOptions<T> {
  /** The agent state before the server sends any. */
  initialState: T;
  /** Endpoint that receives the commands and the state, and streams the new state back. */
  api: string;
  /** Endpoint that reconnects to the run in progress, for `thread.resumeRun(...)`. */
  resumeApi?: string | undefined;
  /**
   * Whether the server retains a run the thread can reconnect to. Requires `resumeApi`; clear it
   * when that run expires or finishes, or the thread changes. A `Signal` keeps the thread in sync.
   */
  canResume?: boolean | Signal<boolean> | undefined;
  /**
   * Endpoint that returns the retained initial state and run id of the run to resume, as
   * `{ runId, state }`. A 204 response means no run is active and the resume is skipped.
   */
  resumeStateApi?: string | undefined;
  /** Wire format of the response stream. Defaults to `'data-stream'`. */
  protocol?: AssistantTransportProtocol | undefined;
  /**
   * When `false`, stream decoding and state reconciliation tolerate malformed input (invalid
   * chunks are dropped with a console log) instead of failing the run. Resume runs always decode
   * leniently. Defaults to `true`.
   */
  strict?: boolean | undefined;
  /** Maximum UTF-16 code units accepted in one data stream or SSE line. Defaults to 16 MiB. */
  maxStreamLineLength?: number | undefined;
  /** Maximum UTF-16 code units retained across one assistant transport event. Defaults to 16 MiB. */
  maxStreamEventLength?: number | undefined;
  /** Turns the agent state into the messages and run state of the thread. */
  converter: AssistantTransportStateConverter<T>;
  /** Request headers, or a function resolving them before each request. */
  headers?: HeadersValue | (() => Promise<HeadersValue>) | undefined;
  /** Extra fields of the request body, or a function resolving them before each request. */
  body?: object | (() => Promise<object | undefined>) | undefined;
  /** Transforms the assembled request body before it is sent. */
  prepareSendCommandsRequest?:
    | ((
        body: SendCommandsRequestBody,
      ) => Record<string, unknown> | Promise<Record<string, unknown>>)
    | undefined;
  onResponse?: ((response: Response) => void | Promise<void>) | undefined;
  /** Called when a run ends, whatever its outcome. */
  onFinish?: (() => void) | undefined;
  /**
   * Called when a run fails, with the commands in transit at that moment. Commands are not
   * restored: use `updateState` to show the failure.
   */
  onError?:
    | ((
        error: Error,
        params: {
          commands: AssistantTransportCommand[];
          updateState: (updater: (state: T) => T) => void;
        },
      ) => void | Promise<void>)
    | undefined;
  /**
   * Called when commands are cancelled: by a cancel, with the commands in transit and queued, or
   * after `onError` settles, with the commands queued behind the failed run and its `error`.
   *
   * A cancel while `onError` is still pending ends the run without waiting for it, so one failed
   * run can call `onCancel` twice: first without `error`, for the commands queued since the
   * failure, then with `error`, for the commands queued before it, once `onError` settles. The
   * second call can arrive after a later run has started.
   */
  onCancel?:
    | ((params: {
        commands: AssistantTransportCommand[];
        updateState: (updater: (state: T) => T) => void;
        error?: Error;
      }) => void)
    | undefined;
  capabilities?: { edit?: boolean | undefined } | undefined;
  adapters?: { attachments?: AttachmentAdapter | undefined } | undefined;
}
