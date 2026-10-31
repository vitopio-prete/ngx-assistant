import type { BackendStore, StoredMessage } from './storage';
import { uiMessageStreamResponse, writeText } from './ui-message-stream';

const TITLE_LENGTH = 40;
const TITLE_DELAY_MS = 20;

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const notFound = () => json({ error: 'Not found' }, 404);

/**
 * The `/api/threads` routes: the list of conversations, their titles and their messages.
 *
 * - `GET /api/threads`, `POST /api/threads`, `GET|PATCH|DELETE /api/threads/:id`
 * - `GET /api/threads/:id/messages`, `PUT|DELETE /api/threads/:id/messages/:messageId`
 * - `POST /api/threads/:id/title`: streams a title made from the first user message (its text, or
 *   the name of its first attachment), and stores it
 */
export async function threads(
  store: BackendStore,
  method: string,
  segments: readonly string[],
  body: string,
  signal: AbortSignal | null,
): Promise<Response> {
  const [id, collection, messageId] = segments;

  if (id === undefined) {
    if (method === 'GET') return json({ threads: store.threads() });
    if (method === 'POST') {
      const remoteId = store.newThreadId();
      store.putThread({ remoteId, status: 'regular', updatedAt: Date.now() });
      return json({ remoteId }, 201);
    }
    return notFound();
  }

  const thread = store.thread(id);
  if (!thread) return notFound();

  if (collection === undefined) {
    if (method === 'GET') return json(thread);
    if (method === 'PATCH') {
      const { title, status } = JSON.parse(body) as Partial<Record<'title' | 'status', unknown>>;
      store.putThread({
        ...thread,
        ...(typeof title === 'string' && { title }),
        ...((status === 'regular' || status === 'archived') && { status }),
      });
      return json(store.thread(id));
    }
    if (method === 'DELETE') {
      store.deleteThread(id);
      return new Response(null, { status: 204 });
    }
    return notFound();
  }

  if (collection === 'messages') {
    if (method === 'GET' && messageId === undefined) return json(store.history(id));
    if (method === 'PUT' && messageId !== undefined) {
      store.putMessage(id, JSON.parse(body) as StoredMessage);
      return new Response(null, { status: 204 });
    }
    if (method === 'DELETE' && messageId !== undefined) {
      store.deleteMessage(id, messageId);
      return new Response(null, { status: 204 });
    }
    return notFound();
  }

  if (collection === 'title' && method === 'POST') {
    const { messages } = JSON.parse(body) as {
      messages: { role: string; text: string; attachments: string[] }[];
    };
    const first = messages.find((m) => m.role === 'user');
    const title = (first?.text.trim() || first?.attachments[0] || 'New chat').slice(
      0,
      TITLE_LENGTH,
    );
    return uiMessageStreamResponse(async (write, pause) => {
      write({ type: 'start' });
      write({ type: 'start-step' });
      await writeText(write, pause, title, TITLE_DELAY_MS);
      // Stored before the stream ends, so a later list never misses it.
      const current = store.thread(id);
      if (current) store.putThread({ ...current, title });
      write({ type: 'finish-step' });
      write({ type: 'finish', finishReason: 'stop' });
    }, signal);
  }

  return notFound();
}
