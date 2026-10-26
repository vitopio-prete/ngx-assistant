import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { AssistantRuntime } from "../runtime/api/assistant-runtime";
import type { RemoteThreadRuntimeFactory } from "../runtimes/remote-thread-list/thread-runtime-factory";
import { makeAdapter } from "./remote-thread-list-test-helpers";
import {
  createMessageStore,
  createRemoteThreadListRuntime,
  externalStoreThreadRuntime,
  getThreadCore,
  localThreadRuntime,
  userMessage,
} from "./remote-thread-list-runtime-test-helpers";

const testInitializationRetry = async (
  threadRuntime: RemoteThreadRuntimeFactory,
  onNew?: ReturnType<typeof vi.fn>,
) => {
  const initializationError = new Error("initialization failed");
  let initializeCount = 0;
  const adapter = makeAdapter({
    initialize: vi.fn(async (threadId: string) => {
      initializeCount++;
      if (initializeCount === 1) throw initializationError;
      return {
        remoteId: `remote-${threadId}`,
        externalId: `external-${threadId}`,
      };
    }),
  });
  const runtimeRef: { current: AssistantRuntime | null } = { current: null };

  const created = createRemoteThreadListRuntime({ adapter, threadRuntime });
  onTestFinished(created.dispose);
  runtimeRef.current = created.runtime;
  await vi.waitFor(() => {
    expect(runtimeRef.current?.threads.mainItem.getState().id).toBeDefined();
  });

  const item = runtimeRef.current!.threads.mainItem;
  const localId = item.getState().id;
  const thread = getThreadCore(runtimeRef.current!);

  if (onNew) {
    // The external-store core dispatches without holding the append on the
    // initialization barrier; the failure surfaces at the dispatch seam.
    await expect(thread.append(userMessage("first"))).resolves.toBeUndefined();
    // Drain the rejection through the binder's catch so the retry
    // re-arms before the second append; the exact chain depth is not
    // load-bearing.
    for (let i = 0; i < 20; i++) await Promise.resolve();
  } else {
    await expect(thread.append(userMessage("first"))).rejects.toMatchObject({
      name: "MessageNotSentError",
      cause: initializationError,
    });
  }
  expect(item.getState().status).toBe("new");

  await expect(thread.append(userMessage("second"))).resolves.toBeUndefined();
  expect(adapter.initialize).toHaveBeenCalledTimes(2);
  expect(adapter.initialize).toHaveBeenLastCalledWith(localId);
  await vi.waitFor(() => {
    expect(item.getState()).toMatchObject({
      id: localId,
      status: "regular",
      remoteId: `remote-${localId}`,
    });
  });
  if (onNew) expect(onNew).toHaveBeenCalledTimes(2);
};

describe("RemoteThreadInstanceManager initialization retry", () => {
  it("retries a rejected initialization for local runtimes", async () => {
    await testInitializationRetry(
      localThreadRuntime({
        run: async () => ({ content: [] }),
      }),
    );
  });

  it("retries a rejected initialization for external-store runtimes", async () => {
    const onNew = vi.fn(async () => {});
    await testInitializationRetry(
      externalStoreThreadRuntime(createMessageStore(), { onNew }),
      onNew,
    );
  });
});
