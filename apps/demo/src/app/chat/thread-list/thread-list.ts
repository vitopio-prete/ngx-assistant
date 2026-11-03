import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  NgZone,
  PLATFORM_ID,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import {
  NxaThreadListItemById,
  NxaThreadListItems as NxaThreadListItemsDirective,
  NxaThreadListLoadMore,
  NxaThreadListNew,
  NxaThreadListRoot,
  fromRuntime,
  injectThreadList,
} from '@ngx-assistant/angular';
import { NxaIcon } from '../icons';
import { groupThreads, startOfDay, startOfNextDay } from './thread-list-groups';
import { NxaThreadListItem } from './thread-list-item';

let nextId = 0;

const LIST_BUTTON =
  'flex h-8 w-full items-center justify-start gap-2 rounded-md px-2.5 text-sm outline-none transition-colors hover:bg-nxa-muted focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:pointer-events-none disabled:opacity-50';

/** The search box of the thread list. `value` is two-way. */
@Component({
  selector: 'nxa-thread-list-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaIcon],
  host: { class: 'relative block px-0.5 py-1', 'data-slot': 'thread-list-search' },
  template: `
    <nxa-icon
      name="search"
      class="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-nxa-muted-foreground"
    />
    <input
      type="search"
      aria-label="Search threads"
      placeholder="Search threads"
      [value]="value()"
      (input)="value.set($any($event.target).value)"
      class="h-8 w-full min-w-0 rounded-lg border border-transparent bg-nxa-muted px-3 py-1 ps-8 text-sm outline-none placeholder:text-nxa-muted-foreground focus-visible:border-nxa-ring focus-visible:bg-nxa-background focus-visible:ring-1 focus-visible:ring-nxa-ring"
    />
  `,
})
export class NxaThreadListSearch {
  readonly value = model('');
}

/**
 * The threads of the thread list, filtered by `query` and grouped by day (Today, Yesterday,
 * Earlier) when they carry dates; skeleton rows while the list loads, "No threads found" when the
 * query matches nothing, and a "Load more" button while the runtime has more threads. The groups
 * follow the local date, also across midnight.
 */
@Component({
  selector: 'nxa-thread-list-items',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaThreadListItemById, NxaThreadListItem, NxaThreadListLoadMore],
  host: { class: 'flex flex-col gap-0.5', 'data-slot': 'thread-list-items' },
  template: `
    @if (state().isLoading) {
      <div role="status" aria-label="Loading threads" class="flex flex-col gap-0.5">
        @for (row of skeleton; track row) {
          <div
            aria-hidden="true"
            class="flex h-8 items-center px-2.5"
            data-slot="thread-list-skeleton"
          >
            <div class="h-3.5 w-full animate-pulse rounded-md bg-nxa-accent"></div>
          </div>
        }
      </div>
    } @else if (query().trim() && result().matches.length === 0) {
      <div
        role="status"
        data-slot="thread-list-empty"
        class="px-2.5 py-4 text-sm text-nxa-muted-foreground"
      >
        No threads found
      </div>
    } @else {
      <!-- One flat list keyed by thread, so a row that moves to another day keeps its state. -->
      @for (entry of entries(); track entry.key) {
        @if (entry.label) {
          <div
            data-slot="thread-list-group-label"
            class="px-2.5 pt-3 pb-1 text-xs font-medium text-nxa-muted-foreground"
          >
            {{ entry.label }}
          </div>
        } @else {
          <nxa-thread-list-item *nxaThreadListItemById="entry.key" />
        }
      }
      @if (state().hasMore) {
        <button nxaThreadListLoadMore data-slot="thread-list-load-more" [class]="loadMore">
          Load more
        </button>
      }
    }
  `,
})
export class NxaThreadListItems {
  /** Shows only the threads whose title contains it. */
  readonly query = input('');

  protected readonly skeleton = [0, 1, 2, 3, 4];
  protected readonly loadMore = `${LIST_BUTTON} justify-center text-nxa-muted-foreground`;
  protected readonly state = fromRuntime(injectThreadList(), (s) => s);
  private readonly startOfToday = signal<number | undefined>(undefined);
  protected readonly result = computed(() => {
    const { threadIds, threadItems } = this.state();
    return groupThreads(threadIds, threadItems, this.query(), this.startOfToday());
  });

  /** The group labels and the rows, in order: a label's key cannot be a thread id. */
  protected readonly entries = computed(() =>
    this.result().groups.flatMap((group) => [
      ...(group.label ? [{ key: `label:${group.label}`, label: group.label }] : []),
      ...group.ids.map((id) => ({ key: id, label: undefined })),
    ]),
  );

  constructor() {
    const now = Date.now();
    this.startOfToday.set(startOfDay(now));
    // The groups follow the date; a server render has no midnight to wait for. The timer runs
    // outside the zone, so a zone app does not wait a day to become stable.
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (from: number) => {
      timer = setTimeout(
        () => {
          const now = Date.now();
          this.startOfToday.set(startOfDay(now));
          schedule(now);
        },
        startOfNextDay(from) - from,
      );
    };
    inject(NgZone).runOutsideAngular(() => schedule(now));
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }
}

/**
 * The archived threads, behind a disclosure that starts closed; nothing while no thread is
 * archived. Their menu restores or deletes them.
 */
@Component({
  selector: 'nxa-thread-list-archived',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaThreadListItemsDirective, NxaThreadListItem, NxaIcon],
  host: { class: 'flex flex-col gap-0.5', 'data-slot': 'thread-list-archived' },
  template: `
    @if (count() > 0) {
      <button
        type="button"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="regionId"
        (click)="open.set(!open())"
        class="mt-2 flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-nxa-muted-foreground outline-none hover:bg-nxa-muted focus-visible:ring-2 focus-visible:ring-nxa-ring"
      >
        <nxa-icon
          name="chevron-right"
          class="size-3.5 transition-transform motion-reduce:transition-none"
          [class.rotate-90]="open()"
        />
        Archived ({{ count() }})
      </button>
      <div [id]="regionId" role="group" aria-label="Archived threads" [hidden]="!open()">
        @if (open()) {
          <nxa-thread-list-item *nxaThreadListItems="let thread; archived: true" />
        }
      </div>
    }
  `,
})
export class NxaThreadListArchived {
  protected readonly regionId = `nxa-thread-list-archived-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly count = fromRuntime(injectThreadList(), (s) => s.archivedThreadIds.length);
}

/**
 * A complete thread list for a sidebar: a "New Thread" button, a search once there are threads,
 * the threads grouped by day with a menu per row (Rename, Archive, Delete) and the archived
 * threads at the end. It needs a runtime with a thread list, such as
 * `provideRemoteThreadListRuntime(...)` or an external store with a thread list adapter.
 *
 * The parts are components of their own (`nxa-thread-list-search`, `nxa-thread-list-items`,
 * `nxa-thread-list-item`, `nxa-thread-list-archived`) to build a different list from.
 *
 * @example
 * ```html
 * <aside class="w-64 p-2"><nxa-thread-list /></aside>
 * ```
 */
@Component({
  selector: 'nxa-thread-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaThreadListRoot,
    NxaThreadListNew,
    NxaThreadListSearch,
    NxaThreadListItems,
    NxaThreadListArchived,
    NxaIcon,
  ],
  host: { class: 'block text-nxa-foreground' },
  template: `
    <nav
      nxaThreadListRoot
      aria-label="Threads"
      data-slot="thread-list"
      class="flex flex-col gap-0.5"
    >
      <button nxaThreadListNew data-slot="thread-list-new" [class]="newButton">
        <nxa-icon name="plus" class="size-4" />
        <span class="whitespace-nowrap">New Thread</span>
      </button>
      @if (hasThreads()) {
        <nxa-thread-list-search [(value)]="search" />
      }
      <nxa-thread-list-items [query]="hasThreads() ? search() : ''" />
      <nxa-thread-list-archived />
    </nav>
  `,
})
export class NxaThreadList {
  protected readonly newButton = `${LIST_BUTTON} data-active:bg-nxa-muted`;
  protected readonly search = signal('');
  protected readonly hasThreads = fromRuntime(injectThreadList(), (s) => s.threadIds.length > 0);
}
