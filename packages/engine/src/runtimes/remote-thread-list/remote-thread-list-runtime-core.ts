import { BaseAssistantRuntimeCore } from "../../runtime/base/base-assistant-runtime-core";
import type { AssistantRuntimeCore } from "../../runtime/interfaces/assistant-runtime-core";
import {
  RemoteThreadListThreadListRuntimeCore,
  type RemoteThreadListRuntimeOptions,
} from "./remote-thread-list-thread-list-runtime-core";

/**
 * Assistant runtime whose threads live in a remote thread list. Model context
 * registered on it reaches each thread through the `modelContext` adapter
 * handed to the thread runtime factory.
 */
export class RemoteThreadListRuntimeCore
  extends BaseAssistantRuntimeCore
  implements AssistantRuntimeCore
{
  public readonly threads;

  constructor(
    options: RemoteThreadListRuntimeOptions,
    initialThreadIdSeed?: string,
  ) {
    super();
    this.threads = new RemoteThreadListThreadListRuntimeCore(
      options,
      this._contextProvider,
      initialThreadIdSeed,
    );
  }
}
