import type { AssistantRuntime } from "../../runtime/api/assistant-runtime";
import type { ThreadListItemRuntime } from "../../runtime/api/thread-list-item-runtime";
import type { RuntimeAdapters } from "./types";

/** What a {@link RemoteThreadRuntimeFactory} gets for the thread it creates. */
export type RemoteThreadRuntimeContext = {
  /** Local id of the thread in the list. */
  readonly threadId: string;
  /** The thread's list item: its status, remote id, title and actions. */
  readonly item: ThreadListItemRuntime;
  /** Adapters of the thread list, such as its model context. */
  readonly adapters: RuntimeAdapters;
  /** Aborted when the thread's runtime is stopped or replaced. */
  readonly signal: AbortSignal;
};

/** A runtime created for one thread, with the cleanup that tears it down. */
export type RemoteThreadRuntimeHandle = {
  readonly runtime: AssistantRuntime;
  dispose(): void;
};

/**
 * Creates the runtime of one thread of a remote thread list. The list calls it
 * once each time it starts a thread, and calls `dispose` on the handle when it
 * stops or restarts that thread. A factory that throws fails the switch to the
 * thread.
 */
export type RemoteThreadRuntimeFactory = (
  context: RemoteThreadRuntimeContext,
) => RemoteThreadRuntimeHandle;
