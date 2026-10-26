import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { ChatModelRunOptions } from "../runtime/utils/chat-model-adapter";
import type {
  RemoteThreadRuntimeContext,
  RemoteThreadRuntimeFactory,
} from "../runtimes/remote-thread-list/thread-runtime-factory";
import { makeAdapter } from "./remote-thread-list-test-helpers";
import {
  createMessageStore,
  createRemoteThreadListRuntime,
  externalStoreThreadRuntime,
  flush,
  getThreadCore,
  localThreadRuntime,
  userMessage,
} from "./remote-thread-list-runtime-test-helpers";

const trackFactory = (inner: RemoteThreadRuntimeFactory) => {
  const contexts: RemoteThreadRuntimeContext[] = [];
  const disposed: string[] = [];
  const factory: RemoteThreadRuntimeFactory = (context) => {
    contexts.push(context);
    const handle = inner(context);
    return {
      runtime: handle.runtime,
      dispose: () => {
        disposed.push(context.threadId);
        handle.dispose();
      },
    };
  };
  return { factory, contexts, disposed };
};

const setup = (
  threadRuntime: RemoteThreadRuntimeFactory,
  adapter = makeAdapter(),
) => {
  const created = createRemoteThreadListRuntime({ adapter, threadRuntime });
  onTestFinished(created.dispose);
  return { ...created, adapter };
};

const echo = localThreadRuntime({
  run: async () => ({ content: [{ type: "text", text: "hi" }] }),
});

describe("RemoteThreadInstanceManager thread runtime factory", () => {
  it("creates the main thread's runtime in a microtask, with its item, adapters and signal", async () => {
    const tracked = trackFactory(echo);
    const { runtime, core } = setup(tracked.factory);

    expect(tracked.contexts).toHaveLength(0);
    await flush();

    expect(tracked.contexts).toHaveLength(1);
    const [context] = tracked.contexts;
    expect(context!.threadId).toBe(runtime.threads.getState().mainThreadId);
    expect(context!.item.getState()).toMatchObject({
      id: context!.threadId,
      status: "new",
    });
    expect(context!.adapters.modelContext).toBe(core.getModelContextProvider());
    expect(context!.signal.aborted).toBe(false);
  });

  it("disposes the runtime of a deleted thread and aborts its signal", async () => {
    const tracked = trackFactory(echo);
    const adapter = makeAdapter({
      list: vi.fn(async () => ({
        threads: [{ status: "regular" as const, remoteId: "thread-a" }],
      })),
    });
    const { runtime } = setup(tracked.factory, adapter);
    await runtime.threads.switchToThread("thread-a");
    const context = tracked.contexts.find(
      ({ threadId }) => threadId === "thread-a",
    )!;

    await runtime.threads.getItemById("thread-a").delete();
    await flush();

    expect(tracked.disposed).toContain("thread-a");
    expect(context.signal.aborted).toBe(true);
  });

  it("disposes every thread runtime when the list is disposed", async () => {
    const tracked = trackFactory(echo);
    const { dispose } = setup(tracked.factory);
    await flush();

    dispose();

    expect(tracked.disposed).toEqual([tracked.contexts[0]!.threadId]);
  });

  it("recreates the thread runtime when the main thread reloads", async () => {
    const tracked = trackFactory(echo);
    const adapter = makeAdapter({
      list: vi.fn(async () => ({
        threads: [{ status: "regular" as const, remoteId: "thread-a" }],
      })),
    });
    const { runtime } = setup(tracked.factory, adapter);
    await runtime.threads.switchToThread("thread-a");
    const contexts = () =>
      tracked.contexts.filter(({ threadId }) => threadId === "thread-a");
    const before = runtime.thread.getState();

    await runtime.threads.reloadMainThread();

    expect(contexts()).toHaveLength(2);
    expect(tracked.disposed).toContain("thread-a");
    expect(contexts()[0]!.signal.aborted).toBe(true);
    expect(contexts()[1]!.signal.aborted).toBe(false);
    expect(runtime.thread.getState()).not.toBe(before);
  });

  it("restarts every thread runtime with a replacement factory", async () => {
    const first = trackFactory(echo);
    const second = trackFactory(echo);
    const adapter = makeAdapter();
    const { core } = setup(first.factory, adapter);
    await flush();

    core.threads.__internal_setOptions({
      adapter,
      threadRuntime: second.factory,
    });
    await flush();

    expect(first.disposed).toHaveLength(1);
    expect(second.contexts).toHaveLength(1);
    expect(second.contexts[0]!.threadId).toBe(first.contexts[0]!.threadId);
  });

  it("rejects the switch when the factory throws", async () => {
    const error = new Error("no runtime");
    const adapter = makeAdapter({
      list: vi.fn(async () => ({
        threads: [{ status: "regular" as const, remoteId: "thread-a" }],
      })),
    });
    const { runtime } = setup((context) => {
      if (context.threadId === "thread-a") throw error;
      return echo(context);
    }, adapter);
    await flush();
    const mainThreadId = runtime.threads.getState().mainThreadId;

    await expect(runtime.threads.switchToThread("thread-a")).rejects.toBe(
      error,
    );
    expect(runtime.threads.getState().mainThreadId).toBe(mainThreadId);
  });

  it("sends the remote id and the list's model context with the first run", async () => {
    const run = vi.fn(async (_options: ChatModelRunOptions) => ({
      content: [{ type: "text" as const, text: "hi" }],
    }));
    const adapter = makeAdapter({
      initialize: vi.fn(async (threadId: string) => ({
        remoteId: `remote-${threadId}`,
      })),
    });
    const { runtime } = setup(localThreadRuntime({ run }), adapter);
    runtime.registerModelContextProvider({
      getModelContext: () => ({ system: "Be brief." }),
      subscribe: () => () => {},
    });
    await flush();
    const localId = runtime.threads.getState().mainThreadId;

    runtime.thread.append("hello");
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    const options = run.mock.calls[0]![0];
    expect(options.unstable_threadId).toBe(`remote-${localId}`);
    expect(options.context.system).toBe("Be brief.");
    expect(adapter.initialize).toHaveBeenCalledWith(localId);
  });

  it("creates the runtime again on the next switch after the factory threw", async () => {
    const adapter = makeAdapter({
      list: vi.fn(async () => ({
        threads: [{ status: "regular" as const, remoteId: "thread-a" }],
      })),
    });
    let failures = 1;
    const { runtime } = setup((context) => {
      if (context.threadId === "thread-a" && failures-- > 0)
        throw new Error("transient");
      return echo(context);
    }, adapter);
    await flush();

    await expect(runtime.threads.switchToThread("thread-a")).rejects.toThrow(
      "transient",
    );
    await runtime.threads.switchToThread("thread-a");

    expect(runtime.threads.getState().mainThreadId).toBe("thread-a");
  });

  it("keeps a send made on the outgoing runtime while the main thread reloads", async () => {
    const onNew = vi.fn(async () => {});
    const tracked = trackFactory(
      externalStoreThreadRuntime(createMessageStore(), { onNew }),
    );
    const adapter = makeAdapter({
      list: vi.fn(async () => ({
        threads: [{ status: "regular" as const, remoteId: "thread-a" }],
      })),
    });
    const { runtime } = setup(tracked.factory, adapter);
    await runtime.threads.switchToThread("thread-a");
    const outgoing = getThreadCore(runtime);

    const reload = runtime.threads.reloadMainThread();
    const send = outgoing.append(userMessage("hello"));
    expect(tracked.disposed).not.toContain("thread-a");
    await reload;
    await send;

    expect(onNew).toHaveBeenCalledOnce();
    expect(tracked.disposed).toContain("thread-a");
    expect(getThreadCore(runtime)).not.toBe(outgoing);
  });

  it("never calls the factory when the list is disposed before the first creation", async () => {
    const tracked = trackFactory(echo);
    const { dispose } = setup(tracked.factory);

    dispose();
    await flush();

    expect(tracked.contexts).toHaveLength(0);
  });
});
