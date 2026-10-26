import { vi } from "vitest";
import { RemoteThreadListThreadListRuntimeCore } from "../runtimes/remote-thread-list/remote-thread-list-thread-list-runtime-core";
import type { RemoteThreadListAdapter } from "../runtimes/remote-thread-list/types";
import type { ModelContextProvider } from "../model-context/types";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const contextProvider: ModelContextProvider = {
  getModelContext: () => ({}),
  subscribe: () => () => {},
};

export function setStartThreadRuntime(
  core: RemoteThreadListThreadListRuntimeCore,
  startThreadRuntime: (id: string) => Promise<unknown>,
) {
  const manager = (
    core as unknown as {
      _instanceManager: {
        startThreadRuntime: (id: string) => Promise<unknown>;
        __internal_isThreadRuntimeAttached: (id: string) => boolean;
      };
    }
  )._instanceManager;
  manager.startThreadRuntime = startThreadRuntime;
  manager.__internal_isThreadRuntimeAttached = () => true;
}

export function makeAdapter(
  overrides: Partial<RemoteThreadListAdapter> = {},
): RemoteThreadListAdapter {
  return {
    list: vi.fn(async () => ({ threads: [] })),
    initialize: vi.fn(async (threadId: string) => ({
      remoteId: threadId,
      externalId: threadId,
    })),
    rename: vi.fn(async () => {}),
    archive: vi.fn(async () => {}),
    unarchive: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    generateTitle: vi.fn(
      async () =>
        new ReadableStream({
          start(c) {
            c.close();
          },
        }) as never,
    ),
    fetch: vi.fn(async (id: string) => ({
      status: "regular" as const,
      remoteId: id,
      externalId: id,
      title: "Test",
    })),
    ...overrides,
  };
}

export function createCore(
  adapter: RemoteThreadListAdapter,
  threadId?: string,
  onThreadIdChange?: (threadId: string | undefined) => void,
): RemoteThreadListThreadListRuntimeCore {
  const core = new RemoteThreadListThreadListRuntimeCore(
    {
      adapter,
      threadRuntime: () => ({ runtime: {} as never, dispose: () => {} }),
      threadId,
      onThreadIdChange,
    },
    contextProvider,
  );
  // `startThreadRuntime` waits for a thread runtime to attach; stub it so
  // tests of the list alone don't hang.
  setStartThreadRuntime(core, async () => ({}));
  return core;
}
