/** A conversation as the backend stores it. */
export interface StoredThread {
  readonly remoteId: string;
  readonly status: 'regular' | 'archived';
  readonly title?: string | undefined;
  /** When the thread was created or last got a message, in milliseconds. */
  readonly updatedAt: number;
}

/** One message of a conversation, with the message it follows. */
export interface StoredMessage {
  readonly parentId: string | null;
  /** The message as the client sent it: the backend only stores it. */
  readonly message: { readonly id: string } & Record<string, unknown>;
}

interface Data {
  version: typeof VERSION;
  nextId: number;
  threads: Record<string, StoredThread>;
  messages: Record<string, { headId: string | null; items: StoredMessage[] }>;
}

const KEY = 'ngx-assistant-demo';
const VERSION = 1;

const empty = (): Data => ({ version: VERSION, nextId: 1, threads: {}, messages: {} });

const isData = (value: unknown): value is Data => {
  const data = value as Partial<Data> | null;
  return (
    data?.version === VERSION &&
    typeof data.nextId === 'number' &&
    typeof data.threads === 'object' &&
    typeof data.messages === 'object'
  );
};

/**
 * The backend's database: conversations and their messages, kept in `localStorage` so they
 * outlive a reload. Starts afresh when what it finds is not its data, and keeps to memory where
 * storage is not available.
 */
export class BackendStore {
  private data: Data = this.read();

  newThreadId(): string {
    const id = `thread-${this.data.nextId++}`;
    this.save();
    return id;
  }

  threads(): StoredThread[] {
    return Object.values(this.data.threads).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  thread(remoteId: string): StoredThread | undefined {
    return this.data.threads[remoteId];
  }

  putThread(thread: StoredThread) {
    this.data.threads[thread.remoteId] = thread;
    this.save();
  }

  deleteThread(remoteId: string) {
    delete this.data.threads[remoteId];
    delete this.data.messages[remoteId];
    this.save();
  }

  history(remoteId: string) {
    return this.data.messages[remoteId] ?? { headId: null, items: [] };
  }

  /**
   * Adds a message, which becomes the head of the thread, or replaces the one with its id in
   * place: an update, such as a tool result, never moves the head back to an earlier message.
   */
  putMessage(remoteId: string, item: StoredMessage) {
    const history = this.history(remoteId);
    const index = history.items.findIndex((i) => i.message.id === item.message.id);
    this.data.messages[remoteId] =
      index === -1
        ? { headId: item.message.id, items: [...history.items, item] }
        : { headId: history.headId, items: history.items.with(index, item) };
    const thread = this.data.threads[remoteId];
    if (thread) this.data.threads[remoteId] = { ...thread, updatedAt: Date.now() };
    this.save();
  }

  deleteMessage(remoteId: string, messageId: string) {
    const history = this.history(remoteId);
    const deleted = history.items.find((i) => i.message.id === messageId);
    const items = history.items.filter((i) => i !== deleted);
    // The head goes back along its own branch.
    const headId = deleted && history.headId === messageId ? deleted.parentId : history.headId;
    this.data.messages[remoteId] = { headId, items };
    this.save();
  }

  private read(): Data {
    try {
      const raw = globalThis.localStorage?.getItem(KEY);
      const data: unknown = raw ? JSON.parse(raw) : null;
      return isData(data) ? data : empty();
    } catch {
      return empty();
    }
  }

  private save() {
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Full or blocked storage: the data stays in memory for this page.
    }
  }
}
