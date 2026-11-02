import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  NxaThreadListItemArchive,
  NxaThreadListItemDelete,
  NxaThreadListItemIf,
  NxaThreadListItemRename,
  NxaThreadListItemRenameInput,
  NxaThreadListItemRoot,
  NxaThreadListItemTitle,
  NxaThreadListItemTrigger,
  NxaThreadListItemUnarchive,
  fromRuntime,
  injectThreadList,
  injectThreadListItem,
} from '@ngx-assistant/angular';
import { NxaIcon } from '../icons';
import { MENU_BESIDE, MENU_ITEM, MENU_ITEM_DESTRUCTIVE, MENU_PANEL } from '../menu/menu';
import { UNTITLED_THREAD } from './thread-list-groups';

/**
 * A row of the thread list, in the scope of its thread (`*nxaThreadListItems` or
 * `*nxaThreadListItemById`): the title that opens the thread, a spinner while the thread is
 * generating, and the "More options" menu with Rename, Archive and Delete (Restore and Delete for
 * an archived thread). Rename turns the title into an input: Enter or leaving it renames, Escape
 * cancels.
 */
@Component({
  selector: 'nxa-thread-list-item',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CdkMenuTrigger,
    CdkMenu,
    CdkMenuItem,
    NxaThreadListItemIf,
    NxaThreadListItemTrigger,
    NxaThreadListItemTitle,
    NxaThreadListItemRename,
    NxaThreadListItemRenameInput,
    NxaThreadListItemArchive,
    NxaThreadListItemUnarchive,
    NxaThreadListItemDelete,
    NxaIcon,
  ],
  hostDirectives: [NxaThreadListItemRoot],
  host: {
    'data-slot': 'thread-list-item',
    class:
      'group relative flex h-8 items-center rounded-md transition-colors hover:bg-nxa-muted has-focus-visible:bg-nxa-muted has-aria-expanded:bg-nxa-muted data-active:bg-nxa-muted',
  },
  template: `
    <input
      *nxaThreadListItemIf="{ renaming: true }; else trigger"
      nxaThreadListItemRenameInput
      aria-label="Rename thread"
      data-slot="thread-list-item-rename"
      class="h-7 w-full min-w-0 flex-1 rounded-md border border-nxa-border bg-nxa-background ps-2.5 pe-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-nxa-ring"
    />
    <ng-template #trigger>
      <button
        nxaThreadListItemTrigger
        data-slot="thread-list-item-trigger"
        class="flex h-full min-w-0 flex-1 items-center rounded-md px-2.5 text-start text-sm outline-none group-hover:pe-9 group-has-focus-visible:pe-9 group-has-aria-expanded:pe-9 group-data-active:pe-9 focus-visible:ring-2 focus-visible:ring-nxa-ring"
      >
        @if (isRunning()) {
          <nxa-icon
            name="loader"
            data-slot="thread-list-item-running"
            class="me-1.5 size-3.5 animate-spin text-nxa-muted-foreground motion-reduce:animate-none"
          />
        }
        <span
          nxaThreadListItemTitle
          [fallback]="untitled"
          data-slot="thread-list-item-title"
          class="min-w-0 flex-1 truncate"
        ></span>
        @if (isRunning()) {
          <span class="sr-only">Running</span>
        }
      </button>
    </ng-template>
    <button
      type="button"
      [cdkMenuTriggerFor]="menu"
      [cdkMenuPosition]="position"
      aria-label="More options"
      title="More options"
      data-slot="thread-list-item-more"
      class="absolute end-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-nxa-muted-foreground opacity-0 outline-none group-hover:opacity-100 group-has-focus-visible:opacity-100 group-data-active:opacity-100 hover:bg-nxa-accent hover:text-nxa-foreground focus-visible:ring-2 focus-visible:ring-nxa-ring aria-expanded:bg-nxa-accent aria-expanded:opacity-100"
    >
      <nxa-icon name="more" class="size-3.5" />
    </button>
    <ng-template #menu>
      <div cdkMenu data-slot="thread-list-item-menu" [class]="panel">
        @if (archived()) {
          <!-- A runtime that cannot restore gets no Restore: a disabled item cannot take the focus. -->
          @if (canUnarchive()) {
            <button
              cdkMenuItem
              nxaThreadListItemUnarchive
              data-slot="thread-list-item-menu-item"
              [class]="item"
            >
              <nxa-icon name="archive-restore" class="size-4" />
              Restore
            </button>
          }
        } @else {
          <button
            cdkMenuItem
            nxaThreadListItemRename
            data-slot="thread-list-item-menu-item"
            [class]="item"
          >
            <nxa-icon name="pencil" class="size-4" />
            Rename
          </button>
          <button
            cdkMenuItem
            nxaThreadListItemArchive
            data-slot="thread-list-item-menu-item"
            [class]="item"
          >
            <nxa-icon name="archive" class="size-4" />
            Archive
          </button>
        }
        <button
          cdkMenuItem
          nxaThreadListItemDelete
          data-slot="thread-list-item-menu-item"
          [class]="destructive"
        >
          <nxa-icon name="trash" class="size-4" />
          Delete
        </button>
      </div>
    </ng-template>
  `,
})
export class NxaThreadListItem {
  protected readonly untitled = UNTITLED_THREAD;
  protected readonly panel = MENU_PANEL;
  protected readonly item = MENU_ITEM;
  protected readonly destructive = MENU_ITEM_DESTRUCTIVE;
  protected readonly position = MENU_BESIDE;

  protected readonly isRunning = fromRuntime(injectThreadListItem(), (s) => s.isRunning);
  protected readonly archived = fromRuntime(injectThreadListItem(), (s) => s.status === 'archived');
  protected readonly canUnarchive = fromRuntime(injectThreadList(), (s) => s.canUnarchive);
}
