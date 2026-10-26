import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  NxaThreadListItemArchive,
  NxaThreadListItemDelete,
  NxaThreadListItemRoot,
  NxaThreadListItems,
  NxaThreadListItemTitle,
  NxaThreadListItemTrigger,
  NxaThreadListItemUnarchive,
  NxaThreadListNew,
  NxaThreadListRoot,
} from '@ngx-assistant/angular';
import { ThreadStore } from './thread-store';

/** The list of conversations: switch, start, archive, restore and delete them. */
@Component({
  selector: 'nxa-demo-thread-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaThreadListRoot,
    NxaThreadListNew,
    NxaThreadListItems,
    NxaThreadListItemRoot,
    NxaThreadListItemTrigger,
    NxaThreadListItemTitle,
    NxaThreadListItemArchive,
    NxaThreadListItemUnarchive,
    NxaThreadListItemDelete,
  ],
  template: `
    <nav nxaThreadListRoot class="thread-list" aria-label="Conversations">
      <button nxaThreadListNew class="new-thread">+ New chat</button>

      <div *nxaThreadListItems="let thread" nxaThreadListItemRoot class="thread-item">
        <button nxaThreadListItemTrigger class="thread-trigger">
          <span nxaThreadListItemTitle #t="nxaThreadListItemTitle" fallback="New chat"></span>
        </button>
        <button
          nxaThreadListItemArchive
          class="action"
          [attr.aria-label]="'Archive ' + (t.title() || 'New chat')"
        >
          Archive
        </button>
      </div>

      @if (store.archived().length) {
        <details class="archived">
          <summary>Archived</summary>
          <div
            *nxaThreadListItems="let thread; archived: true"
            nxaThreadListItemRoot
            class="thread-item"
          >
            <span
              nxaThreadListItemTitle
              #t="nxaThreadListItemTitle"
              fallback="New chat"
              class="thread-title"
            ></span>
            <button
              nxaThreadListItemUnarchive
              class="action"
              [attr.aria-label]="'Restore ' + (t.title() || 'New chat')"
            >
              Restore
            </button>
            <button
              nxaThreadListItemDelete
              class="action"
              [attr.aria-label]="'Delete ' + (t.title() || 'New chat')"
            >
              Delete
            </button>
          </div>
        </details>
      }
    </nav>
  `,
})
export class ThreadSidebar {
  protected readonly store = inject(ThreadStore);
}
