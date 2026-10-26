import type { ThreadListRuntimeCore } from "../runtime/interfaces/thread-list-runtime-core";
import type { RemoteThreadRuntimeFactory } from "../runtimes/remote-thread-list/thread-runtime-factory";

// A thread list that knows every thread id, enough for the manager to build
// the list item it hands to the factory.
export const stubThreadList = (): ThreadListRuntimeCore =>
  ({
    mainThreadId: undefined,
    getItemById: (threadId: string) => ({
      id: threadId,
      remoteId: undefined,
      externalId: undefined,
      title: undefined,
      status: "regular",
    }),
    subscribe: () => () => {},
  }) as unknown as ThreadListRuntimeCore;

// A factory whose runtime has no thread, so nothing attaches: starts stay
// pending until a test publishes a thread runtime itself.
export const unattachedThreadRuntime: RemoteThreadRuntimeFactory = () => ({
  runtime: {} as never,
  dispose: () => {},
});
