import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { injectAssistant } from '@ngx-assistant/angular';
import type { RemoteThreadListAdapter, RemoteThreadMetadata } from '@ngx-assistant/engine';
import { axeViolations } from '../../testing/a11y';
import {
  keydown,
  makeAdapter,
  mountWithThreads,
  slots,
  texts,
  typeInto,
  until,
  withTitles,
} from '../../testing/thread-list-harness';
import { groupThreads } from './thread-list-groups';
import { NxaThreadList } from './thread-list';

const mountThreadList = (adapter: RemoteThreadListAdapter) =>
  mountWithThreads(adapter, NxaThreadList);

const titles = (root: ParentNode) => texts(root, 'thread-list-item-title');
const labels = (root: ParentNode) => texts(root, 'thread-list-group-label');
const menuItems = () => texts(document.body, 'thread-list-item-menu-item');
const menuItem = (label: string) =>
  slots(document.body, 'thread-list-item-menu-item').find(
    (item) => item.textContent?.trim() === label,
  )!;

const search = (root: ParentNode, value: string) =>
  typeInto(root.querySelector<HTMLInputElement>('input[type="search"]')!, value);

/** Opens the "More options" menu of the row at `index`. */
async function openMenu(
  fixture: Awaited<ReturnType<typeof mountThreadList>>['fixture'],
  index = 0,
) {
  const el = fixture.nativeElement as HTMLElement;
  await until(fixture, () =>
    expect(slots(el, 'thread-list-item-more').length).toBeGreaterThan(index),
  );
  slots(el, 'thread-list-item-more')[index]!.click();
  await until(fixture, () => expect(slots(document.body, 'thread-list-item-menu')).toHaveLength(1));
}

/** Opens the rename input of the first row through its menu. */
async function openRename(fixture: Awaited<ReturnType<typeof mountThreadList>>['fixture']) {
  await openMenu(fixture);
  menuItem('Rename').click();
  let input!: HTMLInputElement;
  await until(fixture, () => {
    input = slots(document.body, 'thread-list-item-rename')[0] as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });
  return input;
}

const freezeClockAtMidday = () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('nxa-thread-list', () => {
  it('keeps the runtime order while no thread carries a date', () => {
    const items = { a: { title: 'A' }, b: { title: 'B' } };
    expect(groupThreads(['b', 'a'], items, '', Date.now()).groups).toEqual([
      { label: undefined, ids: ['b', 'a'] },
    ]);
    // Before the day is known the dates are not used either.
    const dated = { a: { title: 'A', lastMessageAt: new Date() }, b: { title: 'B' } };
    expect(groupThreads(['b', 'a'], dated, '', undefined).groups).toEqual([
      { label: undefined, ids: ['b', 'a'] },
    ]);
  });

  it('regroups threads when the local date changes', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 7, 31, 23, 59, 58));
    const { fixture, el } = await mountThreadList(
      makeAdapter([
        { remoteId: 't0', title: 'Late today', lastMessageAt: new Date(2026, 7, 31, 12) },
      ]),
    );
    await vi.advanceTimersByTimeAsync(0);
    await fixture.whenStable();
    expect(labels(el)).toEqual(['Today']);

    await vi.advanceTimersByTimeAsync(2_000);
    await fixture.whenStable();
    expect(labels(el)).toEqual(['Yesterday']);
  });

  it('groups threads by calendar day across a daylight saving transition', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 2, 9, 12));
    const { fixture, el } = await mountThreadList(
      makeAdapter([
        {
          remoteId: 'before-yesterday',
          title: 'Before yesterday',
          lastMessageAt: new Date(2026, 2, 7, 23, 30),
        },
        { remoteId: 'yesterday', title: 'Yesterday', lastMessageAt: new Date(2026, 2, 8, 0, 30) },
      ]),
    );

    await until(fixture, () => {
      expect(labels(el)).toEqual(['Yesterday', 'Earlier']);
      expect(titles(el)).toEqual(['Yesterday', 'Before yesterday']);
    });
  });

  it('renders one row per thread and no group labels when no thread has a date', async () => {
    const { fixture, el } = await mountThreadList(
      makeAdapter(withTitles('First thread', 'Second thread')),
    );

    await until(fixture, () => expect(titles(el)).toEqual(['First thread', 'Second thread']));
    expect(labels(el)).toHaveLength(0);
  });

  it('titles an untitled thread with the New Chat fallback', async () => {
    const { fixture, el } = await mountThreadList(
      makeAdapter([{ remoteId: 't0' }, { remoteId: 't1', title: 'Named' }]),
    );

    await until(fixture, () => expect(titles(el)).toEqual(['New Chat', 'Named']));
  });

  it('hides the search box until the list has threads', async () => {
    const { fixture, el } = await mountThreadList(makeAdapter([]));

    await until(fixture, () => expect(slots(el, 'thread-list-new')).toHaveLength(1));
    expect(slots(el, 'thread-list-search')).toHaveLength(0);
  });

  it('matches titles case-insensitively and ignores surrounding whitespace', async () => {
    const { fixture, el } = await mountThreadList(
      makeAdapter(withTitles('Trip planning', 'Budget review')),
    );
    await until(fixture, () => expect(titles(el)).toHaveLength(2));

    search(el, '  TRIP  ');
    await until(fixture, () => expect(titles(el)).toEqual(['Trip planning']));
  });

  it('matches the New Chat fallback rather than the missing title', async () => {
    const { fixture, el } = await mountThreadList(
      makeAdapter([{ remoteId: 't0' }, { remoteId: 't1', title: 'Named' }]),
    );
    await until(fixture, () => expect(titles(el)).toHaveLength(2));

    search(el, 'new ch');
    await until(fixture, () => expect(titles(el)).toEqual(['New Chat']));
  });

  it('renders the empty state when the query matches nothing', async () => {
    const { fixture, el } = await mountThreadList(makeAdapter(withTitles('Trip planning')));
    await until(fixture, () => expect(titles(el)).toHaveLength(1));

    search(el, 'budget');
    await until(fixture, () =>
      expect(texts(el, 'thread-list-empty')).toEqual(['No threads found']),
    );
    expect(slots(el, 'thread-list-item')).toHaveLength(0);
  });

  it('shows skeleton rows while the list loads and drops them once it resolves', async () => {
    let resolveList!: (response: { threads: RemoteThreadMetadata[] }) => void;
    const { fixture, el } = await mountThreadList(
      makeAdapter([], {
        list: () =>
          new Promise((resolve) => {
            resolveList = resolve;
          }),
      }),
    );
    const status = () => el.querySelectorAll('[role="status"][aria-label="Loading threads"]');

    await until(fixture, () => expect(slots(el, 'thread-list-skeleton')).toHaveLength(5));
    expect(status()).toHaveLength(1);
    expect(
      slots(el, 'thread-list-skeleton').every(
        (row) =>
          row.getAttribute('aria-hidden') === 'true' &&
          !row.hasAttribute('role') &&
          !row.hasAttribute('aria-label'),
      ),
    ).toBe(true);
    expect(slots(el, 'thread-list-item')).toHaveLength(0);

    resolveList({ threads: [{ status: 'regular', remoteId: 't0', title: 'Loaded thread' }] });
    await until(fixture, () => expect(titles(el)).toEqual(['Loaded thread']));
    expect(slots(el, 'thread-list-skeleton')).toHaveLength(0);
    expect(status()).toHaveLength(0);
  });

  it('groups threads by day, newest first, and coalesces a repeated label', async () => {
    const startOfToday = freezeClockAtMidday();
    const { fixture, el } = await mountThreadList(
      makeAdapter([
        {
          remoteId: 't0',
          title: 'Last week',
          lastMessageAt: new Date(startOfToday - 6 * 86_400_000),
        },
        { remoteId: 't1', title: 'Earlier today', lastMessageAt: new Date(startOfToday + 1_000) },
        { remoteId: 't2', title: 'Just now', lastMessageAt: new Date(startOfToday + 60_000) },
        { remoteId: 't3', title: 'Late yesterday', lastMessageAt: new Date(startOfToday - 1_000) },
      ]),
    );

    await until(fixture, () => expect(labels(el)).toEqual(['Today', 'Yesterday', 'Earlier']));
    expect(titles(el)).toEqual(['Just now', 'Earlier today', 'Late yesterday', 'Last week']);
  });

  it('groups a dateless thread under Today once any thread carries a date', async () => {
    const startOfToday = freezeClockAtMidday();
    const { fixture, el } = await mountThreadList(
      makeAdapter([
        { remoteId: 't0', title: 'No date' },
        {
          remoteId: 't1',
          title: 'Last week',
          lastMessageAt: new Date(startOfToday - 6 * 86_400_000),
        },
      ]),
    );

    await until(fixture, () => expect(labels(el)).toEqual(['Today', 'Earlier']));
    expect(titles(el)).toEqual(['No date', 'Last week']);
  });

  it('opens the item menu and archives through the menu item', async () => {
    const adapter = makeAdapter(withTitles('Trip planning'));
    const { fixture } = await mountThreadList(adapter);

    await openMenu(fixture);
    expect(menuItems()).toEqual(['Rename', 'Archive', 'Delete']);

    menuItem('Archive').click();
    await vi.waitFor(() => expect(adapter.archive).toHaveBeenCalledWith('t0'));
    await until(fixture, () =>
      expect(slots(document.body, 'thread-list-item-menu')).toHaveLength(0),
    );
  });

  it('deletes through the menu item', async () => {
    const adapter = makeAdapter(withTitles('Trip planning', 'Budget review'));
    const { fixture, el } = await mountThreadList(adapter);

    await openMenu(fixture, 1);
    menuItem('Delete').click();
    await vi.waitFor(() => expect(adapter.delete).toHaveBeenCalledWith('t1'));
    await until(fixture, () => expect(titles(el)).toEqual(['Trip planning']));
  });

  it('runs the menu from the keyboard and gives the focus back to its button', async () => {
    const { fixture, el } = await mountThreadList(makeAdapter(withTitles('Trip planning')));
    await until(fixture, () => expect(slots(el, 'thread-list-item-more')).toHaveLength(1));
    const more = slots(el, 'thread-list-item-more')[0]!;
    expect(more.getAttribute('aria-haspopup')).toBe('menu');
    expect(more.getAttribute('aria-label')).toBe('More options');

    more.focus();
    keydown(more, 'ArrowDown', { keyCode: 40 });
    await until(fixture, () => expect(document.activeElement).toBe(menuItem('Rename')));
    expect(more.getAttribute('aria-expanded')).toBe('true');

    keydown(menuItem('Rename'), 'ArrowDown', { keyCode: 40 });
    await until(fixture, () => expect(document.activeElement).toBe(menuItem('Archive')));

    keydown(menuItem('Archive'), 'Escape', { keyCode: 27 });
    await until(fixture, () => {
      expect(slots(document.body, 'thread-list-item-menu')).toHaveLength(0);
      expect(document.activeElement).toBe(more);
    });
  });

  it('marks the running thread with a spinner and a screen reader label', async () => {
    let finish!: () => void;
    const { fixture, el } = await mountWithThreads(
      makeAdapter(withTitles('Trip planning')),
      NxaThreadList,
      {
        model: {
          async *run() {
            yield { content: [{ type: 'text', text: 'Thinking' }] };
            await new Promise<void>((resolve) => (finish = resolve));
          },
        },
      },
    );
    await until(fixture, () => expect(titles(el)).toEqual(['Trip planning']));
    slots(el, 'thread-list-item-trigger')[0]!.click();
    await until(fixture, () =>
      expect(slots(el, 'thread-list-item')[0]!.hasAttribute('data-active')).toBe(true),
    );

    const assistant = runInInjectionContext(TestBed.inject(EnvironmentInjector), () =>
      injectAssistant(),
    );
    assistant.thread.append('Plan a trip');
    await until(fixture, () => expect(slots(el, 'thread-list-item-running')).toHaveLength(1));
    expect(slots(el, 'thread-list-item-trigger')[0]!.textContent).toContain('Running');

    finish();
    await until(fixture, () => expect(slots(el, 'thread-list-item-running')).toHaveLength(0));
  });

  it('loads more threads while the runtime has more', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        threads: [{ status: 'regular', remoteId: 't0', title: 'First' }],
        nextCursor: 'next',
      })
      .mockResolvedValueOnce({ threads: [{ status: 'regular', remoteId: 't1', title: 'Second' }] });
    const { fixture, el } = await mountThreadList(makeAdapter([], { list }));
    await until(fixture, () => expect(texts(el, 'thread-list-load-more')).toEqual(['Load more']));

    slots(el, 'thread-list-load-more')[0]!.click();
    await until(fixture, () => expect(titles(el)).toEqual(['First', 'Second']));
    expect(list).toHaveBeenLastCalledWith({ after: 'next' });
    expect(slots(el, 'thread-list-load-more')).toHaveLength(0);
  });

  it('lists the archived threads behind a disclosure, restores and deletes them', async () => {
    const adapter = makeAdapter([
      { remoteId: 't0', title: 'Kept' },
      { remoteId: 'a0', title: 'Old trip', status: 'archived' },
    ]);
    const { fixture, el } = await mountThreadList(adapter);
    const toggle = () => el.querySelector<HTMLButtonElement>('[aria-controls]')!;
    const archived = () =>
      texts(el.querySelector('[aria-label="Archived threads"]')!, 'thread-list-item-title');

    await until(fixture, () => expect(toggle().textContent?.trim()).toBe('Archived (1)'));
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(archived()).toEqual([]);
    expect(titles(el)).toEqual(['Kept']);

    toggle().click();
    await until(fixture, () => expect(archived()).toEqual(['Old trip']));
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    await openMenu(fixture, 1);
    expect(menuItems()).toEqual(['Restore', 'Delete']);
    menuItem('Restore').click();
    await vi.waitFor(() => expect(adapter.unarchive).toHaveBeenCalledWith('a0'));
    await until(fixture, () => expect(titles(el).sort()).toEqual(['Kept', 'Old trip']));
    expect(el.querySelector('[aria-controls]')).toBeNull();
  });

  it('offers no Restore when the runtime cannot restore threads', async () => {
    const adapter = makeAdapter([
      { remoteId: 't0', title: 'Kept' },
      { remoteId: 'a0', title: 'Old trip', status: 'archived' },
    ]);
    delete (adapter as Partial<typeof adapter>).unarchive;
    const { fixture, el } = await mountThreadList(adapter);
    await until(fixture, () => expect(el.querySelector('[aria-controls]')).toBeTruthy());
    el.querySelector<HTMLButtonElement>('[aria-controls]')!.click();

    await openMenu(fixture, 1);
    expect(menuItems()).toEqual(['Delete']);
  });

  it('keeps a row, and its rename, when its thread moves to another day', async () => {
    const startOfToday = freezeClockAtMidday();
    const adapter = makeAdapter([
      { remoteId: 't0', title: 'Moving', lastMessageAt: new Date(startOfToday - 1_000) },
      { remoteId: 't1', title: 'Today', lastMessageAt: new Date(startOfToday + 1_000) },
    ]);
    const { fixture, el } = await mountThreadList(adapter);
    await until(fixture, () => expect(labels(el)).toEqual(['Today', 'Yesterday']));
    const row = slots(el, 'thread-list-item')[1]!;

    await openMenu(fixture, 1);
    menuItem('Rename').click();
    await until(fixture, () => expect(slots(el, 'thread-list-item-rename')).toHaveLength(1));

    // The list reloads with the thread active today.
    (adapter.list as ReturnType<typeof vi.fn>).mockResolvedValue({
      threads: [
        {
          status: 'regular',
          remoteId: 't0',
          title: 'Moving',
          lastMessageAt: new Date(startOfToday + 5_000),
        },
        {
          status: 'regular',
          remoteId: 't1',
          title: 'Today',
          lastMessageAt: new Date(startOfToday + 1_000),
        },
      ],
    });
    const list = runInInjectionContext(TestBed.inject(EnvironmentInjector), () =>
      injectAssistant(),
    ).threads;
    await list.reload();
    await until(fixture, () => expect(labels(el)).toEqual(['Today']));
    expect(slots(el, 'thread-list-item')[0]).toBe(row);
    expect(slots(el, 'thread-list-item-rename')).toHaveLength(1);
  });

  it('has no axe violations, with and without the menu open', async () => {
    const { fixture, el } = await mountThreadList(
      makeAdapter([
        ...withTitles('Trip planning', 'Budget review'),
        { remoteId: 'a0', title: 'Old', status: 'archived' },
      ]),
    );
    await until(fixture, () => expect(titles(el)).toHaveLength(2));
    expect(await axeViolations(el)).toEqual([]);

    await openMenu(fixture);
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('nxa-thread-list rename', () => {
  it.each([
    { label: 'IME keyCode', event: { keyCode: 229 } },
    { label: 'isComposing', event: { isComposing: true } },
  ])('ignores Enter during $label and commits on plain Enter', async ({ event }) => {
    const adapter = makeAdapter(withTitles('Trip planning'));
    const { fixture } = await mountThreadList(adapter);

    const input = await openRename(fixture);
    typeInto(input, 'Trip notes');
    keydown(input, 'Enter', event);
    await fixture.whenStable();

    expect(adapter.rename).not.toHaveBeenCalled();
    expect(slots(document.body, 'thread-list-item-rename')).toHaveLength(1);

    keydown(input, 'Enter');
    await vi.waitFor(() => expect(adapter.rename).toHaveBeenCalledWith('t0', 'Trip notes'));
  });

  it('seeds the rename input with the current title and commits the trimmed value', async () => {
    const adapter = makeAdapter(withTitles('Trip planning'));
    const { fixture, el } = await mountThreadList(adapter);

    const input = await openRename(fixture);
    expect(input.value).toBe('Trip planning');

    typeInto(input, '  Trip notes  ');
    keydown(input, 'Enter');
    await vi.waitFor(() => expect(adapter.rename).toHaveBeenCalledWith('t0', 'Trip notes'));
    await until(fixture, () => {
      expect(slots(el, 'thread-list-item-rename')).toHaveLength(0);
      expect(titles(el)).toEqual(['Trip notes']);
      expect(document.activeElement).toBe(slots(el, 'thread-list-item-trigger')[0]);
    });
  });

  it('leaves the title alone when the value is unchanged or blank', async () => {
    const adapter = makeAdapter(withTitles('Trip planning'));
    const { fixture, el } = await mountThreadList(adapter);

    const blank = await openRename(fixture);
    typeInto(blank, '   ');
    keydown(blank, 'Enter');
    await until(fixture, () => expect(slots(el, 'thread-list-item-rename')).toHaveLength(0));

    const unchanged = await openRename(fixture);
    keydown(unchanged, 'Enter');
    await until(fixture, () => expect(slots(el, 'thread-list-item-rename')).toHaveLength(0));

    expect(adapter.rename).not.toHaveBeenCalled();
  });

  it('discards the edit on escape', async () => {
    const adapter = makeAdapter(withTitles('Trip planning'));
    const { fixture, el } = await mountThreadList(adapter);

    const input = await openRename(fixture);
    typeInto(input, 'Discarded');
    keydown(input, 'Escape');

    await until(fixture, () => expect(slots(el, 'thread-list-item-rename')).toHaveLength(0));
    expect(adapter.rename).not.toHaveBeenCalled();
    expect(titles(el)).toEqual(['Trip planning']);
  });

  it('keeps the editor open when the rename is rejected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const adapter = makeAdapter(withTitles('Trip planning'), {
      rename: vi.fn(async () => {
        throw new Error('rename failed');
      }),
    });
    const { fixture, el } = await mountThreadList(adapter);

    const input = await openRename(fixture);
    typeInto(input, 'Trip notes');
    keydown(input, 'Enter');

    await vi.waitFor(() => expect(adapter.rename).toHaveBeenCalled());
    await fixture.whenStable();
    expect(slots(el, 'thread-list-item-rename')).toHaveLength(1);
    expect(input.value).toBe('Trip notes');
  });
});
