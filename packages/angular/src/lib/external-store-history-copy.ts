import {
  appendToolInteraction,
  isErrorMessageId,
  readToolInteractionLog,
  type ThreadHistoryAdapter,
  type ThreadMessage,
  type ThreadRuntime,
  type Unstable_RecordToolInteractionOptions,
  type Unstable_ToolInteractionLog,
} from '@ngx-assistant/engine';

// Prefix of the ids the engine gives store messages that bring none; such ids change between
// conversions, so those messages are never copied. The engine does not export it.
const FALLBACK_ID_PREFIX = '__external_store_fallback_';

type Signature = string | ThreadMessage;

/**
 * Copies the settled turns of an external store thread to a thread history adapter with
 * `unstable_copy`, and keeps the tool interactions recorded on its messages in that copy. A
 * branch is copied when a run ends, or when an interaction is recorded while the thread is idle;
 * only the messages that are new or changed since the last copy are named. Messages already in
 * the thread when it is attached, or when a run starts, count as copied. Not part of the public
 * API.
 */
export class ExternalStoreHistoryCopy {
  private thread: ThreadRuntime | undefined;
  private history: ThreadHistoryAdapter | undefined;
  private lastHistory: ThreadHistoryAdapter | undefined;
  private session = 0;
  private copied = new Map<string, Signature>();
  private failedIds = new Set<string>();
  private interactions = new Map<string, Map<string, Unstable_ToolInteractionLog>>();
  private overlaid = new WeakMap<
    ThreadMessage,
    { logs: Map<string, Unstable_ToolInteractionLog>; message: ThreadMessage }
  >();
  private pending = false;
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private waiters: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  private warned = false;

  private signature(message: ThreadMessage): Signature {
    try {
      return (
        JSON.stringify({
          role: message.role,
          content: message.content,
          attachments: message.role === 'user' ? message.attachments : undefined,
          status: message.role === 'assistant' ? message.status : undefined,
          metadata: message.metadata,
        }) ?? message
      );
    } catch {
      // A message that cannot be serialized is compared by identity.
      return message;
    }
  }

  private messages(): readonly ThreadMessage[] {
    return this.thread?.getState().messages ?? [];
  }

  private branch(): ThreadMessage[] {
    return this.messages()
      .filter(
        (message) =>
          !message.metadata.isOptimistic &&
          !message.id.startsWith(FALLBACK_ID_PREFIX) &&
          !isErrorMessageId(message.id) &&
          !(message.role === 'assistant' && message.status.type === 'running'),
      )
      .map((message) => {
        const logs = this.interactions.get(message.id);
        if (!logs) return message;
        // The overlay is kept per message so an unchanged message keeps its signature.
        const cached = this.overlaid.get(message);
        if (
          cached &&
          cached.logs.size === logs.size &&
          [...logs].every(([id, log]) => cached.logs.get(id) === log)
        ) {
          return cached.message;
        }
        const copy = {
          ...message,
          content: message.content.map((part) => {
            if (part.type !== 'tool-call') return part;
            const log = logs.get(part.toolCallId);
            return log ? { ...part, unstable_interactions: log } : part;
          }),
        } as ThreadMessage;
        this.overlaid.set(message, { logs: new Map(logs), message: copy });
        return copy;
      });
  }

  private seed(): void {
    for (const message of this.branch()) {
      if (!this.copied.has(message.id) && !this.failedIds.has(message.id)) {
        this.copied.set(message.id, this.signature(message));
      }
    }
  }

  /** Starts copying `thread` to `history`; returns the function that stops it. */
  public attach(thread: ThreadRuntime, history: ThreadHistoryAdapter): () => void {
    if (history !== this.lastHistory) {
      this.copied.clear();
      this.failedIds.clear();
      this.interactions.clear();
      this.overlaid = new WeakMap();
      this.lastHistory = history;
      this.session += 1;
    }
    this.thread = thread;
    this.history = history;
    this.seed();
    const offStart = thread.unstable_on('runStart', () => this.seed());
    const offEnd = thread.unstable_on('runEnd', () => void this.schedule());
    return () => {
      offStart();
      offEnd();
      if (this.timer !== undefined) clearTimeout(this.timer);
      this.timer = undefined;
      this.pending = false;
      const detached = new Error('History copy was detached.');
      for (const waiter of this.waiters.splice(0)) waiter.reject(detached);
      this.thread = undefined;
      this.history = undefined;
    };
  }

  /** The store's `unstable_onRecordToolInteraction` while history is copied. */
  public recordInteraction = async (
    options: Unstable_RecordToolInteractionOptions,
  ): Promise<void> => {
    const thread = this.thread;
    const message = this.messages().find((item) => item.id === options.messageId);
    const part = message?.content.find(
      (item) => item.type === 'tool-call' && item.toolCallId === options.toolCallId,
    );
    if (!thread || !message || part?.type !== 'tool-call') {
      throw new Error('Tool call is not available.');
    }

    // While a run is open, the interaction is copied with the rest of the run when it ends.
    const isRunning = thread.getState().isRunning;
    if (!isRunning) this.seed();
    let logs = this.interactions.get(message.id);
    if (!logs) {
      logs = new Map();
      this.interactions.set(message.id, logs);
    }
    logs.set(
      options.toolCallId,
      appendToolInteraction(
        logs.get(options.toolCallId) ?? readToolInteractionLog(part.unstable_interactions),
        options.interaction,
      ),
    );

    if (!isRunning) await this.schedule(true);
  };

  private schedule(wait = false): Promise<void> {
    this.pending = true;
    const result = wait
      ? new Promise<void>((resolve, reject) => {
          this.waiters.push({ resolve, reject });
        })
      : Promise.resolve();
    // One copy runs at a time; a copy asked for meanwhile runs after it.
    if (this.history && !this.inFlight && this.timer === undefined) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, 0);
    }
    return result;
  }

  private async flush(): Promise<void> {
    if (!this.pending || !this.history) return;
    const history = this.history;
    const session = this.session;
    this.pending = false;
    this.inFlight = true;
    const waiters = this.waiters.splice(0);
    const branch = this.branch();
    const changed = branch
      .map((message) => [message.id, this.signature(message)] as const)
      .filter(([id, signature]) => this.copied.get(id) !== signature);

    try {
      if (changed.length > 0) {
        await history.unstable_copy?.(
          branch,
          changed.map(([id]) => id),
        );
        if (session === this.session) {
          for (const [id, signature] of changed) {
            this.copied.set(id, signature);
            this.failedIds.delete(id);
          }
        }
      }
      for (const waiter of waiters) waiter.resolve();
    } catch (error) {
      // Failed messages stay out of the seed, so the next copy names them again.
      if (session === this.session) {
        for (const [id] of changed) this.failedIds.add(id);
      }
      if (!this.warned) {
        this.warned = true;
        console.warn('[ngx-assistant] Failed to copy the thread history.', error);
      }
      for (const waiter of waiters) waiter.reject(error);
    } finally {
      this.inFlight = false;
      if (this.pending) void this.schedule();
    }
  }
}
