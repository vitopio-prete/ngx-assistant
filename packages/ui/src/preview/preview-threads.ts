import { titleStream } from '@ngx-assistant/angular';
import type { RemoteThreadListAdapter, RemoteThreadMetadata } from '@ngx-assistant/engine';

const DAY = 86_400_000;

/**
 * A thread list kept in the page, seeded with a few threads of different days, so the sidebar and
 * the modal have something to group, search, rename and archive. Titles come from the first
 * message.
 */
export function previewThreads(): RemoteThreadListAdapter {
  const now = Date.now();
  const threads = new Map<string, RemoteThreadMetadata>(
    [
      {
        remoteId: 'trip',
        title: 'Plan a weekend in Lisbon',
        lastMessageAt: new Date(now - 3_600_000),
      },
      { remoteId: 'budget', title: 'Budget review', lastMessageAt: new Date(now - DAY) },
      { remoteId: 'recipe', title: 'Vegetarian lasagna', lastMessageAt: new Date(now - 6 * DAY) },
      { remoteId: 'old', title: 'Old notes', status: 'archived' as const },
    ].map((thread) => [thread.remoteId, { status: 'regular', ...thread }]),
  );
  let created = 0;
  const update = (remoteId: string, change: Partial<RemoteThreadMetadata>) => {
    const thread = threads.get(remoteId);
    if (thread) threads.set(remoteId, { ...thread, ...change });
  };

  return {
    list: async () => ({ threads: [...threads.values()] }),
    initialize: async () => {
      const remoteId = `new-${++created}`;
      threads.set(remoteId, { remoteId, status: 'regular', lastMessageAt: new Date() });
      return { remoteId, externalId: undefined };
    },
    rename: async (remoteId, title) => update(remoteId, { title }),
    archive: async (remoteId) => update(remoteId, { status: 'archived' }),
    unarchive: async (remoteId) => update(remoteId, { status: 'regular' }),
    delete: async (remoteId) => void threads.delete(remoteId),
    fetch: async (remoteId) => {
      const thread = threads.get(remoteId);
      if (!thread) throw new Error(`Unknown thread ${remoteId}`);
      return thread;
    },
    generateTitle: async (_remoteId, messages) => {
      const first = messages.find((message) => message.role === 'user');
      const text = first?.content.map((part) => (part.type === 'text' ? part.text : '')).join(' ');
      return titleStream((text ?? '').trim().slice(0, 40) || 'New Chat');
    },
  };
}
