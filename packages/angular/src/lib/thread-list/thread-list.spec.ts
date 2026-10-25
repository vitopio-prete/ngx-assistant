import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  Provider,
  Type,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  ExternalStoreAdapter,
  ExternalStoreThreadData,
  ThreadListRuntime,
  ThreadListState,
  ThreadMessageLike,
} from '@ngx-assistant/engine';
import { provideExternalStoreRuntime } from '../external-store-runtime';
import { provideLocalRuntime } from '../local-runtime';
import { NXA_ASSISTANT, NXA_THREAD_LIST, injectThread, injectThreadListItem } from '../scopes';
import { NxaThreadListItems } from './thread-list-items';
import {
  NxaThreadListItemArchive,
  NxaThreadListItemDelete,
  NxaThreadListItemUnarchive,
} from './thread-list-item-actions';
import { NxaThreadListItemRoot } from './thread-list-item-root';
import { NxaThreadListItemTitle } from './thread-list-item-title';
import { NxaThreadListItemTrigger } from './thread-list-item-trigger';
import { NxaThreadListLoadMore } from './thread-list-load-more';
import { NxaThreadListNew } from './thread-list-new';
import { NxaThreadListRoot } from './thread-list-root';

type Regular = ExternalStoreThreadData<'regular'>;
type Archived = ExternalStoreThreadData<'archived'>;

const regular = (id: string, title?: string): Regular => ({ id, status: 'regular', title });
const archivedThread = (id: string, title?: string): Archived => ({
  id,
  status: 'archived',
  title,
});

/** An external store with a thread list whose threads move as the handlers are called. */
function createStore(
  initial: readonly Regular[] = ['first', 'second', 'third'].map((id) => regular(id, id)),
  initialArchived: readonly Archived[] = [],
) {
  const threadId = signal(initial[0]?.id ?? 'DEFAULT_THREAD_ID');
  const threads = signal<readonly Regular[]>(initial);
  const archived = signal<readonly Archived[]>(initialArchived);
  const canUnarchive = signal(true);
  let created = 0;
  const onSwitchToThread = vi.fn((id: string) => threadId.set(id));
  const onSwitchToNewThread = vi.fn(() => {
    const id = `new-${++created}`;
    threads.update((list) => [regular(id), ...list]);
    threadId.set(id);
  });
  const onArchive = vi.fn((id: string) => {
    const thread = threads().find((t) => t.id === id)!;
    threads.update((list) => list.filter((t) => t.id !== id));
    archived.update((list) => [archivedThread(id, thread.title), ...list]);
  });
  const onUnarchiveHandler = vi.fn((id: string) => {
    const thread = archived().find((t) => t.id === id)!;
    archived.update((list) => list.filter((t) => t.id !== id));
    threads.update((list) => [...list, regular(id, thread.title)]);
  });
  const onDelete = vi.fn((id: string) => {
    threads.update((list) => list.filter((t) => t.id !== id));
    archived.update((list) => list.filter((t) => t.id !== id));
  });
  const provider = provideExternalStoreRuntime<ThreadMessageLike>(() =>
    computed((): ExternalStoreAdapter<ThreadMessageLike> => ({
      messages: [],
      convertMessage: (message) => message,
      onNew: async () => undefined,
      adapters: {
        threadList: {
          threadId: threadId(),
          threads: threads(),
          archivedThreads: archived(),
          onSwitchToThread,
          onSwitchToNewThread,
          onArchive,
          onUnarchive: canUnarchive() ? onUnarchiveHandler : undefined,
          onDelete,
        },
      },
    })),
  );
  return {
    threadId,
    threads,
    archived,
    canUnarchive,
    onSwitchToThread,
    onSwitchToNewThread,
    onArchive,
    onUnarchive: onUnarchiveHandler,
    onDelete,
    provider,
  };
}

/** Wraps the thread list so that its state reports other fields, and `loadMore` is a spy. */
function threadListWith(fields: () => Partial<ThreadListState>, loadMore = vi.fn()): Provider {
  return {
    provide: NXA_THREAD_LIST,
    useFactory: () => {
      const threads = inject(NXA_ASSISTANT)!.threads;
      return Object.assign(Object.create(threads) as ThreadListRuntime, {
        getState: () => ({ ...threads.getState(), ...fields() }),
        loadMore,
      });
    },
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

const click = (target: Element) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  target.dispatchEvent(event);
  return event;
};

const keydown = (target: Element, key: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...init }),
  );

/** Stamps each row with the title it was created with, to tell a reused row from a new one. */
@Component({ selector: 'nxa-test-initial', template: '{{ initial }}' })
class InitialTitle {
  readonly initial = injectThreadListItem().getState().title;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaThreadListRoot,
    NxaThreadListNew,
    NxaThreadListLoadMore,
    NxaThreadListItems,
    NxaThreadListItemRoot,
    NxaThreadListItemTrigger,
    NxaThreadListItemTitle,
    NxaThreadListItemArchive,
    NxaThreadListItemUnarchive,
    NxaThreadListItemDelete,
    InitialTitle,
  ],
  template: `
    <nav nxaThreadListRoot class="list">
      <button nxaThreadListNew class="new" [disabled]="disabled()">New</button>
      <div
        *nxaThreadListItems="let thread; let i = index; let n = count"
        nxaThreadListItemRoot
        class="item"
        [attr.data-id]="thread().id"
        [attr.data-pos]="i + '/' + n"
      >
        <button nxaThreadListItemTrigger class="trigger" [disabled]="disabled()">
          <span nxaThreadListItemTitle class="title" fallback="New chat"></span>
        </button>
        <nxa-test-initial class="initial" />
        <button nxaThreadListItemArchive class="archive" [disabled]="disabled()">Archive</button>
        <button nxaThreadListItemDelete class="delete" [disabled]="disabled()">Delete</button>
      </div>
      <div
        *nxaThreadListItems="let thread; archived: true"
        class="archived"
        [attr.data-id]="thread().id"
      >
        <span nxaThreadListItemTitle class="title"></span>
        <button nxaThreadListItemUnarchive class="unarchive" [disabled]="disabled()">
          Restore
        </button>
      </div>
      <button nxaThreadListLoadMore class="more" [disabled]="disabled()">More</button>
    </nav>
  `,
})
class List {
  readonly disabled = signal(false);
}

async function mount<T>(providers: Provider[], component: Type<T>) {
  TestBed.configureTestingModule({ providers });
  const fixture = TestBed.createComponent(component);
  document.body.append(fixture.nativeElement);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

const until = (fixture: ComponentFixture<unknown>, check: () => void) =>
  vi.waitFor(async () => {
    await fixture.whenStable();
    check();
  });

const all = (fixture: ComponentFixture<unknown>, selector: string) =>
  Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(selector));
const one = <E extends HTMLElement = HTMLButtonElement>(
  fixture: ComponentFixture<unknown>,
  selector: string,
) => (fixture.nativeElement as HTMLElement).querySelector<E>(selector)!;
const ids = (fixture: ComponentFixture<unknown>, selector = '.item') =>
  all(fixture, selector).map((element) => element.dataset['id']);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('*nxaThreadListItems', () => {
  it('renders a thread list item scope per thread, with its position', async () => {
    const store = createStore();
    const fixture = await mount([store.provider], List);

    expect(ids(fixture)).toEqual(['first', 'second', 'third']);
    expect(all(fixture, '.item').map((item) => item.dataset['pos'])).toEqual(['0/3', '1/3', '2/3']);
    expect(all(fixture, '.item .title').map((title) => title.textContent)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('does not reuse a row for a different thread', async () => {
    const store = createStore();
    const fixture = await mount([store.provider], List);

    store.threads.set([store.threads()[1]!]);
    await until(fixture, () => expect(ids(fixture)).toEqual(['second']));
    expect(one(fixture, '.item .initial').textContent).toBe('second');
  });

  it('keeps a row on its thread when an earlier thread is archived or deleted', async () => {
    const store = createStore();
    const fixture = await mount([store.provider], List);
    const third = all(fixture, '.item')[2]!;

    click(one(fixture, '.item .archive'));
    await until(fixture, () => expect(ids(fixture)).toEqual(['second', 'third']));
    expect(store.onArchive).toHaveBeenCalledWith('first');
    expect(ids(fixture, '.archived')).toEqual(['first']);
    expect(all(fixture, '.item')[1]).toBe(third);
    expect(third.dataset['pos']).toBe('1/2');

    click(one(fixture, '.item .delete'));
    await until(fixture, () => expect(ids(fixture)).toEqual(['third']));
    expect(store.onDelete).toHaveBeenCalledWith('second');
    expect(all(fixture, '.item')[0]).toBe(third);
    expect(third.querySelector('.initial')!.textContent).toBe('third');
  });

  it('follows a title change in place', async () => {
    const store = createStore([regular('a', 'Old'), regular('b')]);
    const fixture = await mount([store.provider], List);
    const row = all(fixture, '.item')[0]!;

    store.threads.set([regular('a', 'New'), regular('b')]);
    await until(fixture, () => expect(row.querySelector('.title')!.textContent).toBe('New'));
    expect(all(fixture, '.item')[0]).toBe(row);
  });

  it('renders nothing for a runtime with a single built-in thread', async () => {
    const fixture = await mount(
      [
        provideLocalRuntime({
          async *run() {
            yield { content: [] };
          },
        }),
      ],
      List,
    );
    expect(all(fixture, '.item')).toHaveLength(0);
    expect(all(fixture, '.archived')).toHaveLength(0);
  });

  it('releases a row subscription with the row and every subscription with the list', async () => {
    const live = { list: 0, items: 0 };
    const counted = <T extends { subscribe(callback: () => void): () => void }>(
      runtime: T,
      key: keyof typeof live,
    ): T =>
      Object.assign(Object.create(runtime) as T, {
        subscribe: (callback: () => void) => {
          live[key]++;
          const unsubscribe = runtime.subscribe(callback);
          return () => {
            live[key]--;
            unsubscribe();
          };
        },
      });
    const store = createStore();
    const fixture = await mount(
      [
        store.provider,
        {
          provide: NXA_THREAD_LIST,
          useFactory: () => {
            const threads = inject(NXA_ASSISTANT)!.threads;
            return Object.assign(counted(threads, 'list'), {
              getItemById: (id: string) => counted(threads.getItemById(id), 'items'),
            });
          },
        },
      ],
      List,
    );
    const perRow = live.items / 3;
    expect(perRow).toBeGreaterThan(0);

    store.threads.set(store.threads().slice(1));
    await until(fixture, () => expect(ids(fixture)).toEqual(['second', 'third']));
    expect(live.items).toBe(perRow * 2);

    fixture.destroy();
    expect(live).toEqual({ list: 0, items: 0 });
  });
});

describe('[nxaThreadListItemTitle]', () => {
  it('renders the title, or the fallback while it is missing or empty', async () => {
    const store = createStore([regular('a', 'Trip'), regular('b'), regular('c', '')]);
    const fixture = await mount([store.provider], List);

    expect(all(fixture, '.item .title').map((title) => title.textContent)).toEqual([
      'Trip',
      'New chat',
      'New chat',
    ]);
  });
});

describe('thread switching', () => {
  it('switches to the thread of the row and tracks the main thread', async () => {
    const store = createStore();
    const fixture = await mount([store.provider], List);
    const items = all(fixture, '.item');
    const triggers = all(fixture, '.trigger');

    expect(items[0]!.getAttribute('data-active')).toBe('true');
    expect(items[0]!.getAttribute('aria-current')).toBe('true');
    expect(triggers[0]!.getAttribute('data-active')).toBe('true');

    click(triggers[1]!);
    await until(fixture, () => {
      expect(store.onSwitchToThread).toHaveBeenCalledWith('second');
      expect(items[1]!.getAttribute('data-active')).toBe('true');
      expect(items[1]!.getAttribute('aria-current')).toBe('true');
      expect(triggers[1]!.getAttribute('aria-current')).toBe('true');
    });
    expect(items[0]!.hasAttribute('data-active')).toBe(false);
    expect(items[0]!.hasAttribute('aria-current')).toBe(false);
    expect(triggers[0]!.hasAttribute('data-active')).toBe(false);
  });

  it('keeps the trigger working without either root', async () => {
    @Component({
      imports: [NxaThreadListItems, NxaThreadListItemTrigger],
      template: `<button *nxaThreadListItems nxaThreadListItemTrigger>go</button>`,
    })
    class Bare {}
    const store = createStore();
    const fixture = await mount([store.provider], Bare);

    click(all(fixture, 'button')[1]!);
    await until(fixture, () => expect(store.onSwitchToThread).toHaveBeenCalledWith('second'));
  });

  it('switches to a new thread from the new button', async () => {
    const store = createStore();
    const fixture = await mount([store.provider], List);

    click(one(fixture, '.new'));
    await until(fixture, () => expect(ids(fixture)).toEqual(['new-1', 'first', 'second', 'third']));
    expect(store.onSwitchToNewThread).toHaveBeenCalledOnce();
    expect(all(fixture, '.item')[0]!.getAttribute('data-active')).toBe('true');
  });

  it('marks the new button active while the new thread is the main one', async () => {
    const newThreadId = signal<string | undefined>(undefined);
    const store = createStore();
    const fixture = await mount(
      [
        store.provider,
        threadListWith(() => ({ newThreadId: newThreadId(), mainThreadId: 'draft' })),
      ],
      List,
    );
    const button = one(fixture, '.new');
    expect(button.hasAttribute('data-active')).toBe(false);

    newThreadId.set('draft');
    await until(fixture, () => {
      fixture.detectChanges();
      expect(button.getAttribute('data-active')).toBe('true');
    });
    expect(button.getAttribute('aria-current')).toBe('true');
  });

  it('honours disabled and a capture-phase veto on every button', async () => {
    const store = createStore([regular('a'), regular('b')], [archivedThread('z')]);
    const fixture = await mount([store.provider], List);
    const buttons = ['.new', '.item:nth-of-type(2) .trigger', '.archive', '.delete', '.unarchive'];

    const veto = (event: Event) => event.preventDefault();
    fixture.nativeElement.addEventListener('click', veto, { capture: true });
    for (const selector of buttons) click(one(fixture, selector));
    fixture.nativeElement.removeEventListener('click', veto, { capture: true });

    fixture.componentInstance.disabled.set(true);
    await until(fixture, () => {
      for (const selector of buttons) expect(one(fixture, selector).disabled).toBe(true);
    });
    for (const selector of buttons) click(one(fixture, selector));
    await flush();

    expect(store.onSwitchToNewThread).not.toHaveBeenCalled();
    expect(store.onSwitchToThread).not.toHaveBeenCalled();
    expect(store.onArchive).not.toHaveBeenCalled();
    expect(store.onDelete).not.toHaveBeenCalled();
    expect(store.onUnarchive).not.toHaveBeenCalled();
  });

  it('reports a failed action instead of leaving it unhandled', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createStore();
    store.onArchive.mockImplementationOnce(() => {
      throw new Error('offline');
    });
    const fixture = await mount([store.provider], List);

    click(one(fixture, '.archive'));
    await until(fixture, () =>
      expect(error).toHaveBeenCalledWith(
        '[ngx-assistant] Archiving the thread failed',
        expect.any(Error),
      ),
    );
    error.mockRestore();
  });
});

describe('button[nxaThreadListItemUnarchive]', () => {
  it('tracks adapter support and cannot be enabled by disabled=false', async () => {
    const store = createStore([], [archivedThread('archived', 'Archived')]);
    store.canUnarchive.set(false);
    const fixture = await mount([store.provider], List);
    const button = one(fixture, '.unarchive');

    expect(button.disabled).toBe(true);
    click(button);
    expect(store.onUnarchive).not.toHaveBeenCalled();

    store.canUnarchive.set(true);
    await until(fixture, () => expect(button.disabled).toBe(false));
    click(button);
    await until(fixture, () => expect(ids(fixture)).toEqual(['archived']));
    expect(store.onUnarchive).toHaveBeenCalledWith('archived');
    expect(all(fixture, '.archived')).toHaveLength(0);
  });

  it('updates availability when only the adapter callback changes', async () => {
    const store = createStore([], [archivedThread('archived')]);
    const fixture = await mount([store.provider], List);
    const button = one(fixture, '.unarchive');
    expect(button.disabled).toBe(false);

    store.canUnarchive.set(false);
    await until(fixture, () => expect(button.disabled).toBe(true));
    store.canUnarchive.set(true);
    await until(fixture, () => expect(button.disabled).toBe(false));
    expect(store.onUnarchive).not.toHaveBeenCalled();
  });
});

describe('*nxaThreadListItems archived input', () => {
  it('switches between the regular and the archived threads', async () => {
    @Component({
      imports: [NxaThreadListItems],
      template: `<i
        *nxaThreadListItems="let thread; archived: archived()"
        [attr.data-id]="thread().id"
      ></i>`,
    })
    class Toggle {
      readonly archived = signal(false);
    }
    const store = createStore([regular('a'), regular('b')], [archivedThread('z')]);
    const fixture = await mount([store.provider], Toggle);
    expect(ids(fixture, 'i')).toEqual(['a', 'b']);

    fixture.componentInstance.archived.set(true);
    await until(fixture, () => expect(ids(fixture, 'i')).toEqual(['z']));
    fixture.componentInstance.archived.set(false);
    await until(fixture, () => expect(ids(fixture, 'i')).toEqual(['a', 'b']));
  });
});

describe('button[nxaThreadListLoadMore]', () => {
  it('loads more only while more threads are available and no load is in flight', async () => {
    const fields = signal<Partial<ThreadListState>>({ hasMore: false });
    const loadMore = vi.fn(async () => undefined);
    const store = createStore();
    const fixture = await mount([store.provider, threadListWith(() => fields(), loadMore)], List);
    const button = one(fixture, '.more');

    // The patched state is read on notification; nudge the store to notify.
    const nudge = async (next: Partial<ThreadListState>) => {
      fields.set(next);
      store.threads.set([...store.threads()]);
      await fixture.whenStable();
      fixture.detectChanges();
    };

    expect(button.disabled).toBe(true);
    await nudge({ hasMore: true, isLoading: true });
    expect(button.disabled).toBe(true);
    await nudge({ hasMore: true, isLoadingMore: true });
    expect(button.disabled).toBe(true);
    await nudge({ hasMore: true });
    expect(button.disabled).toBe(false);

    click(button);
    await flush();
    expect(loadMore).toHaveBeenCalledOnce();
  });

  it('reports a rejected load instead of leaving it unhandled', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const loadMore = vi.fn(() => Promise.reject(new Error('offline')));
    const fixture = await mount(
      [createStore().provider, threadListWith(() => ({ hasMore: true }), loadMore)],
      List,
    );

    click(one(fixture, '.more'));
    await until(fixture, () =>
      expect(error).toHaveBeenCalledWith(
        '[ngx-assistant] Loading more threads failed',
        expect.any(Error),
      ),
    );
    error.mockRestore();
  });

  it('is disabled for a runtime that cannot page', async () => {
    const fixture = await mount([createStore().provider], List);
    expect(one(fixture, '.more').disabled).toBe(true);
  });
});

describe('thread list keyboard navigation', () => {
  it('moves through triggers in document order without wrapping', async () => {
    const store = createStore();
    const fixture = await mount([store.provider], List);
    const [first, second, third] = all(fixture, '.trigger');
    const [firstItem, , thirdItem] = all(fixture, '.item');
    firstItem!.parentElement!.insertBefore(thirdItem!, firstItem!);

    third!.focus();
    expect(keydown(third!, 'ArrowDown')).toBe(false);
    expect(document.activeElement).toBe(first);
    expect(keydown(first!, 'ArrowDown')).toBe(false);
    expect(document.activeElement).toBe(second);
    expect(keydown(second!, 'ArrowDown')).toBe(true);
    expect(document.activeElement).toBe(second);
    expect(keydown(first!, 'ArrowUp')).toBe(false);
    expect(document.activeElement).toBe(third);
    expect(keydown(third!, 'ArrowUp')).toBe(true);
    expect(document.activeElement).toBe(third);
  });

  it('ignores keys with modifiers and keys from other elements of the row', async () => {
    const store = createStore();
    const fixture = await mount([store.provider], List);
    const [first] = all(fixture, '.trigger');

    first!.focus();
    expect(keydown(first!, 'ArrowDown', { shiftKey: true })).toBe(true);
    expect(keydown(first!, 'ArrowDown', { altKey: true })).toBe(true);
    expect(keydown(first!, 'ArrowDown', { ctrlKey: true })).toBe(true);
    expect(keydown(first!, 'ArrowDown', { metaKey: true })).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(keydown(one(fixture, '.archive'), 'ArrowDown')).toBe(true);
  });

  it('goes past disabled triggers', async () => {
    @Component({
      imports: [
        NxaThreadListRoot,
        NxaThreadListItems,
        NxaThreadListItemRoot,
        NxaThreadListItemTrigger,
      ],
      template: `
        <div nxaThreadListRoot>
          <div *nxaThreadListItems="let thread" nxaThreadListItemRoot>
            <button nxaThreadListItemTrigger [disabled]="thread().id === 'second'">go</button>
          </div>
        </div>
      `,
    })
    class WithDisabled {}
    const store = createStore();
    const fixture = await mount([store.provider], WithDisabled);
    const [first, , third] = all(fixture, 'button');

    first!.focus();
    expect(keydown(first!, 'ArrowDown')).toBe(false);
    expect(document.activeElement).toBe(third);
    expect(keydown(third!, 'ArrowUp')).toBe(false);
    expect(document.activeElement).toBe(first);
  });

  it('lets a caller veto the move', async () => {
    const store = createStore();
    const fixture = await mount([store.provider], List);
    const [first] = all(fixture, '.trigger');
    first!.addEventListener('keydown', (event) => event.preventDefault());

    first!.focus();
    expect(keydown(first!, 'ArrowDown')).toBe(false);
    expect(document.activeElement).toBe(first);

    const item = all(fixture, '.item')[1]!;
    const second = all(fixture, '.trigger')[1]!;
    item.addEventListener('keydown', (event) => event.preventDefault(), { capture: true });
    second.focus();
    expect(keydown(second, 'ArrowDown')).toBe(false);
    expect(document.activeElement).toBe(second);
  });

  it('skips the trigger of a row that is gone', async () => {
    const store = createStore();
    const fixture = await mount([store.provider], List);

    store.threads.set(store.threads().filter((thread) => thread.id !== 'second'));
    await until(fixture, () => expect(ids(fixture)).toEqual(['first', 'third']));
    const [first, third] = all(fixture, '.trigger');
    first!.focus();
    expect(keydown(first!, 'ArrowDown')).toBe(false);
    expect(document.activeElement).toBe(third);
  });

  it('does not move without a thread list root', async () => {
    @Component({
      imports: [NxaThreadListItems, NxaThreadListItemRoot, NxaThreadListItemTrigger],
      template: `<div *nxaThreadListItems nxaThreadListItemRoot>
        <button nxaThreadListItemTrigger>go</button>
      </div>`,
    })
    class NoRoot {}
    const store = createStore();
    const fixture = await mount([store.provider], NoRoot);
    const [first] = all(fixture, 'button');

    first!.focus();
    expect(keydown(first!, 'ArrowDown')).toBe(true);
    expect(document.activeElement).toBe(first);
  });
});

describe('scopes', () => {
  it('keeps the main thread scope on the main thread after a switch', async () => {
    @Component({ template: '' })
    class Probe {
      readonly thread = injectThread();
    }
    const store = createStore();
    const fixture = await mount([store.provider], Probe);
    const thread = fixture.componentInstance.thread;

    store.threadId.set('third');
    await until(fixture, () =>
      expect(TestBed.inject(Injector).get(NXA_THREAD_LIST)!.getState().mainThreadId).toBe('third'),
    );
    expect(thread.getState().threadId).toBe('third');
  });
});
