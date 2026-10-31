import type {
  ExportedMessageRepositoryItem,
  RemoteThreadInitializeResponse,
  RemoteThreadListAdapter,
  RemoteThreadListResponse,
  RemoteThreadMetadata,
  ThreadHistoryAdapter,
  ThreadListItemRuntime,
  ThreadMessage,
} from '@ngx-assistant/engine';
import { UIMessageStreamDecoder, type AssistantStream } from 'assistant-stream';

async function api(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`/api/${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} /api/${path}: ${response.status}`);
  return response;
}

const send = (method: string, path: string, body?: unknown) =>
  api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

interface ThreadPayload {
  remoteId: string;
  status: 'regular' | 'archived';
  title?: string;
  updatedAt: number;
}

const toMetadata = (thread: ThreadPayload): RemoteThreadMetadata => ({
  remoteId: thread.remoteId,
  status: thread.status,
  title: thread.title,
  lastMessageAt: new Date(thread.updatedAt),
});

const threadPath = (remoteId: string) => `threads/${encodeURIComponent(remoteId)}`;

/** The conversations of the backend, for `provideRemoteThreadListRuntime`. */
export const threadListAdapter: RemoteThreadListAdapter = {
  async list(): Promise<RemoteThreadListResponse> {
    const { threads } = (await (await api('threads')).json()) as { threads: ThreadPayload[] };
    return { threads: threads.map(toMetadata) };
  },
  async fetch(remoteId) {
    return toMetadata((await (await api(threadPath(remoteId))).json()) as ThreadPayload);
  },
  async initialize(): Promise<RemoteThreadInitializeResponse> {
    const { remoteId } = (await (await send('POST', 'threads', {})).json()) as { remoteId: string };
    return { remoteId, externalId: undefined };
  },
  async rename(remoteId, title) {
    await send('PATCH', threadPath(remoteId), { title });
  },
  async archive(remoteId) {
    await send('PATCH', threadPath(remoteId), { status: 'archived' });
  },
  async unarchive(remoteId) {
    await send('PATCH', threadPath(remoteId), { status: 'regular' });
  },
  async delete(remoteId) {
    await send('DELETE', threadPath(remoteId));
  },
  async generateTitle(remoteId, messages): Promise<AssistantStream> {
    const response = await send('POST', `${threadPath(remoteId)}/title`, {
      messages: messages.map((m) => ({
        role: m.role,
        text: textOf(m),
        attachments: m.attachments?.map((a) => a.name) ?? [],
      })),
    });
    return response.body!.pipeThrough(new UIMessageStreamDecoder());
  },
};

const textOf = (message: ThreadMessage) =>
  message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');

// JSON turns dates into strings: give the messages theirs back.
const revive = (item: ExportedMessageRepositoryItem): ExportedMessageRepositoryItem => ({
  ...item,
  message: { ...item.message, createdAt: new Date(item.message.createdAt) },
});

/**
 * The messages of one conversation on the backend, for its runtime. A conversation that has not
 * been saved yet has none; its first message saves it, which gives it its remote id.
 */
export function threadHistory(item: ThreadListItemRuntime): ThreadHistoryAdapter {
  const messagesPath = async (messageId?: string) => {
    const { remoteId } = await item.initialize();
    const path = `${threadPath(remoteId)}/messages`;
    return messageId === undefined ? path : `${path}/${encodeURIComponent(messageId)}`;
  };
  const put = async (entry: ExportedMessageRepositoryItem) => {
    await send('PUT', await messagesPath(entry.message.id), entry);
  };

  return {
    scopeId: item.getState().id,
    async load() {
      const { remoteId } = item.getState();
      if (!remoteId) return { messages: [] };
      const history = (await (await api(`${threadPath(remoteId)}/messages`)).json()) as {
        headId: string | null;
        items: ExportedMessageRepositoryItem[];
      };
      return { headId: history.headId, messages: history.items.map(revive) };
    },
    append: put,
    update: put,
    async delete(items) {
      // Nothing of a conversation that was never saved is on the backend.
      if (!item.getState().remoteId) return;
      for (const entry of items) await send('DELETE', await messagesPath(entry.message.id));
    },
  };
}
