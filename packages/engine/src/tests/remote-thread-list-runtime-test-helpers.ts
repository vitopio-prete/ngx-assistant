import { AssistantRuntimeImpl } from "../runtime/api/assistant-runtime";
import type { AssistantRuntime } from "../runtime/api/assistant-runtime";
import { disposeThreadRuntime } from "../runtime/utils/thread-runtime-lifecycle";
import type { ThreadMessageLike } from "../runtime/utils/thread-message-like";
import type { ChatModelAdapter } from "../runtime/utils/chat-model-adapter";
import { LocalRuntimeCore } from "../runtimes/local/local-runtime-core";
import type { ExternalStoreAdapter } from "../runtimes/external-store/external-store-adapter";
import { ExternalStoreRuntimeCore } from "../runtimes/external-store/external-store-runtime-core";
import { RemoteThreadListRuntimeCore } from "../runtimes/remote-thread-list/remote-thread-list-runtime-core";
import type { RemoteThreadListRuntimeOptions } from "../runtimes/remote-thread-list/remote-thread-list-thread-list-runtime-core";
import type { RemoteThreadRuntimeFactory } from "../runtimes/remote-thread-list/thread-runtime-factory";
import type { AppendMessage } from "../types/message";

// A thread runtime on the local runtime, wired as a framework binding would:
// the list's model context is registered, the history loads once and the
// thread is detached on dispose.
export const localThreadRuntime =
  (chatModel: ChatModelAdapter): RemoteThreadRuntimeFactory =>
  ({ adapters }) => {
    const { modelContext, ...threadAdapters } = adapters;
    const core = new LocalRuntimeCore(
      { adapters: { ...threadAdapters, chatModel } },
      undefined,
    );
    const runtime = new AssistantRuntimeImpl(core);
    const unregister = modelContext
      ? runtime.registerModelContextProvider(modelContext)
      : undefined;
    const thread = core.threads.getMainThreadRuntimeCore();
    void thread.__internal_load().catch(() => {});
    return {
      runtime,
      dispose: () => {
        unregister?.();
        thread.detach();
      },
    };
  };

export type MessageStore = {
  messages: readonly ThreadMessageLike[];
  listeners: Set<() => void>;
  subscribe(callback: () => void): () => void;
  set(messages: readonly ThreadMessageLike[]): void;
};

export const createMessageStore = (): MessageStore => {
  const store: MessageStore = {
    messages: [],
    listeners: new Set(),
    subscribe(callback) {
      store.listeners.add(callback);
      return () => store.listeners.delete(callback);
    },
    set(messages) {
      store.messages = messages;
      for (const listener of store.listeners) listener();
    },
  };
  return store;
};

// A thread runtime on the external store runtime whose messages follow
// `store`, as a binding that re-reads the store on each change would.
export const externalStoreThreadRuntime =
  (
    store: MessageStore,
    adapter: Omit<
      ExternalStoreAdapter<ThreadMessageLike>,
      "messages" | "convertMessage"
    >,
  ): RemoteThreadRuntimeFactory =>
  () => {
    const toAdapter = (): ExternalStoreAdapter<ThreadMessageLike> => ({
      ...adapter,
      messages: store.messages,
      convertMessage: (message: ThreadMessageLike) => message,
    });
    const core = new ExternalStoreRuntimeCore(toAdapter());
    const unsubscribe = store.subscribe(() => core.setAdapter(toAdapter()));
    return {
      runtime: new AssistantRuntimeImpl(core),
      dispose: () => {
        unsubscribe();
        disposeThreadRuntime(core.threads.getMainThreadRuntimeCore());
      },
    };
  };

// The assistant runtime over a remote thread list, with its first load
// started, as a binding sets it up.
export const createRemoteThreadListRuntime = (
  options: RemoteThreadListRuntimeOptions,
) => {
  const core = new RemoteThreadListRuntimeCore(options);
  void core.threads.__internal_load();
  const runtime: AssistantRuntime = new AssistantRuntimeImpl(core);
  return {
    core,
    runtime,
    dispose: () => core.threads.__internal_dispose(),
  };
};

export const userMessage = (text: string): AppendMessage => ({
  parentId: null,
  sourceId: null,
  runConfig: {},
  role: "user",
  content: [{ type: "text", text }],
  attachments: [],
  metadata: { custom: {} },
  createdAt: new Date(),
  startRun: false,
});

export const getThreadCore = (runtime: AssistantRuntime) =>
  (
    runtime.thread as unknown as {
      __internal_threadBinding: {
        getState(): { append(message: AppendMessage): Promise<void> };
      };
    }
  ).__internal_threadBinding.getState();

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Runs `fn` and lets the tasks it queues settle, where a framework test would
// wait for its render to commit.
export const act = async (fn: () => unknown): Promise<void> => {
  await fn();
  await flush();
};

// Starts a task and waits until it settles; the result is the task itself.
export const actSettled = async <T>(start: () => Promise<T>): Promise<T> => {
  const task = start();
  task.catch(() => {});
  await task.then(
    () => {},
    () => {},
  );
  await flush();
  return task;
};
