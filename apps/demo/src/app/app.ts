import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { provideExternalStoreRuntime } from '@ngx-assistant/angular';
import type { ExternalStoreAdapter } from '@ngx-assistant/engine';
import { Chat } from './chat';
import { ThreadSidebar } from './thread-sidebar';
import { ThreadStore } from './thread-store';

/**
 * The demo shell. The thread list runs on an external store runtime that only knows the
 * conversations of `ThreadStore`; each conversation is a chat with its own local runtime, kept
 * alive while another one is shown, so it keeps its messages and branches.
 */
@Component({
  selector: 'nxa-demo-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Chat, ThreadSidebar],
  providers: [
    ThreadStore,
    provideExternalStoreRuntime(() => {
      const store = inject(ThreadStore);
      return computed((): ExternalStoreAdapter => ({
        messages: [],
        // The conversations are written in their own chats, never in this thread.
        onNew: async () => undefined,
        adapters: {
          threadList: {
            threadId: store.mainId(),
            threads: store.threads(),
            archivedThreads: store.archived(),
            onSwitchToNewThread: () => store.create(),
            onSwitchToThread: (id: string) => store.switchTo(id),
            onArchive: (id: string) => store.archive(id),
            onUnarchive: (id: string) => store.unarchive(id),
            onDelete: (id: string) => store.delete(id),
          },
        },
      }));
    }),
  ],
  template: `
    <aside class="sidebar">
      <h1>ngx-assistant</h1>
      <nxa-demo-thread-sidebar />
    </aside>
    <main class="main">
      @for (id of store.ids(); track id) {
        <nxa-demo-chat [threadId]="id" [hidden]="id !== store.mainId()" />
      }
    </main>
  `,
})
export class App {
  protected readonly store = inject(ThreadStore);
}
