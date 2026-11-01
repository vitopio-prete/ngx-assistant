import { ChangeDetectionStrategy, Component, Type, computed, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  ExternalStoreAdapter,
  ExternalStoreThreadData,
  ThreadMessageLike,
} from '@ngx-assistant/engine';
import { provideExternalStoreRuntime } from '../external-store-runtime';
import { injectThreadListItemUi } from '../scopes';
import {
  NxaThreadListItemRename,
  NxaThreadListItemRenameInput,
  NxaThreadListItemIf,
} from './thread-list-item-rename';
import { NxaThreadListItemRoot } from './thread-list-item-root';
import { NxaThreadListItemTitle } from './thread-list-item-title';
import { NxaThreadListItemTrigger } from './thread-list-item-trigger';
import { NxaThreadListItems } from './thread-list-items';
import { NxaThreadListRoot } from './thread-list-root';

type Regular = ExternalStoreThreadData<'regular'>;

/** An external store whose threads are renamed by `onRename`, unless `rename` is replaced. */
function createStore() {
  const threads = signal<readonly Regular[]>([
    { id: 't0', status: 'regular', title: 'Trip planning' },
    { id: 't1', status: 'regular', title: 'Groceries' },
  ]);
  const threadId = signal('t0');
  const onRename = vi.fn(async (id: string, title: string) => {
    threads.update((list) => list.map((t) => (t.id === id ? { ...t, title } : t)));
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
          onSwitchToThread: (id) => threadId.set(id),
          onRename,
        },
      },
    })),
  );
  return { threads, threadId, onRename, provider };
}

/** Exposes the item UI state of its row, to start a rename from code as a menu would. */
@Component({ selector: 'nxa-test-ui', template: '' })
class ItemUi {
  readonly ui = injectThreadListItemUi();
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaThreadListRoot,
    NxaThreadListItems,
    NxaThreadListItemRoot,
    NxaThreadListItemTrigger,
    NxaThreadListItemTitle,
    NxaThreadListItemRename,
    NxaThreadListItemRenameInput,
    NxaThreadListItemIf,
    ItemUi,
  ],
  template: `
    <nav nxaThreadListRoot>
      <div
        *nxaThreadListItems="let thread"
        nxaThreadListItemRoot
        class="item"
        [attr.data-id]="thread().id"
      >
        <input
          *nxaThreadListItemIf="{ renaming: true }; else trigger"
          nxaThreadListItemRenameInput
          class="rename-input"
          aria-label="Rename thread"
        />
        <ng-template #trigger>
          <button nxaThreadListItemTrigger class="trigger">
            <span nxaThreadListItemTitle class="title"></span>
          </button>
        </ng-template>
        <span *nxaThreadListItemIf="{ main: true }" class="main">main</span>
        <button nxaThreadListItemRename class="rename" [disabled]="disabled()">Rename</button>
        <nxa-test-ui />
      </div>
    </nav>
  `,
})
class List {
  readonly disabled = signal(false);
}

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await fixture.whenStable();
}

/**
 * A row whose root wraps only the trigger, with a rename input that stays in the DOM, outside
 * the root and outside any `*nxaThreadListItemIf`.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaThreadListItems,
    NxaThreadListItemRoot,
    NxaThreadListItemTrigger,
    NxaThreadListItemTitle,
    NxaThreadListItemRename,
    NxaThreadListItemRenameInput,
  ],
  template: `
    <section *nxaThreadListItems="let thread" class="item" [attr.data-id]="thread().id">
      <div nxaThreadListItemRoot>
        <button nxaThreadListItemTrigger class="trigger">
          <span nxaThreadListItemTitle class="title"></span>
        </button>
      </div>
      <input nxaThreadListItemRenameInput class="rename-input" aria-label="Rename thread" />
      <button nxaThreadListItemRename class="rename">Rename</button>
    </section>
  `,
})
class LooseList {}

async function mount<T = List>(
  store: ReturnType<typeof createStore>,
  component: Type<T> = List as Type<T>,
) {
  TestBed.configureTestingModule({ providers: [store.provider] });
  const fixture = TestBed.createComponent(component);
  document.body.append(fixture.nativeElement);
  fixture.detectChanges();
  await settle(fixture);
  return fixture;
}

const until = (fixture: ComponentFixture<unknown>, check: () => void) =>
  vi.waitFor(async () => {
    await fixture.whenStable();
    check();
  });

const row = (fixture: ComponentFixture<unknown>, id = 't0') =>
  (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`.item[data-id="${id}"]`)!;
const inputOf = (fixture: ComponentFixture<unknown>, id = 't0') =>
  row(fixture, id).querySelector<HTMLInputElement>('.rename-input');
const titleOf = (fixture: ComponentFixture<unknown>, id = 't0') =>
  row(fixture, id).querySelector('.title')?.textContent;

const click = (target: Element) =>
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
const keydown = (target: Element, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...init });
  target.dispatchEvent(event);
  return event;
};
const type = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
};

async function startRename(fixture: ComponentFixture<unknown>, id = 't0') {
  click(row(fixture, id).querySelector('.rename')!);
  await settle(fixture);
  return inputOf(fixture, id)!;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('thread list item rename', () => {
  it('opens a rename input seeded with the current title, focused and selected', async () => {
    const store = createStore();
    const fixture = await mount(store);
    expect(inputOf(fixture)).toBeNull();
    expect(row(fixture).hasAttribute('data-nxa-renaming')).toBe(false);

    const input = await startRename(fixture);

    expect(input.value).toBe('Trip planning');
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Trip planning'.length]);
    expect(row(fixture).querySelector('.trigger')).toBeNull();
    expect(row(fixture).hasAttribute('data-nxa-renaming')).toBe(true);
    expect(inputOf(fixture, 't1')).toBeNull();
    expect(row(fixture, 't1').hasAttribute('data-nxa-renaming')).toBe(false);
  });

  it('commits the trimmed value on Enter and gives the focus back to the trigger', async () => {
    const store = createStore();
    const fixture = await mount(store);
    const input = await startRename(fixture);
    type(input, '  Trip notes  ');

    const event = keydown(input, 'Enter');
    expect(event.defaultPrevented).toBe(true);

    await until(fixture, () => expect(inputOf(fixture)).toBeNull());
    expect(store.onRename).toHaveBeenCalledExactlyOnceWith('t0', 'Trip notes');
    expect(titleOf(fixture)).toBe('Trip notes');
    await until(fixture, () =>
      expect(document.activeElement).toBe(row(fixture).querySelector('.trigger')),
    );
  });

  it('commits on blur without moving the focus', async () => {
    const store = createStore();
    const fixture = await mount(store);
    const input = await startRename(fixture);
    type(input, 'Trip notes');
    const other = row(fixture, 't1').querySelector<HTMLButtonElement>('.trigger')!;

    other.focus();

    await until(fixture, () => expect(inputOf(fixture)).toBeNull());
    expect(store.onRename).toHaveBeenCalledExactlyOnceWith('t0', 'Trip notes');
    await settle(fixture);
    expect(document.activeElement).toBe(other);
  });

  it('leaves the title alone when the value is unchanged or blank', async () => {
    const store = createStore();
    const fixture = await mount(store);

    keydown(await startRename(fixture), 'Enter');
    await until(fixture, () => expect(inputOf(fixture)).toBeNull());

    const input = await startRename(fixture);
    type(input, '   ');
    keydown(input, 'Enter');
    await until(fixture, () => expect(inputOf(fixture)).toBeNull());

    expect(store.onRename).not.toHaveBeenCalled();
    expect(titleOf(fixture)).toBe('Trip planning');
  });

  it('discards the edit on Escape and gives the focus back to the trigger', async () => {
    const store = createStore();
    const fixture = await mount(store);
    const input = await startRename(fixture);
    type(input, 'Trip notes');

    expect(keydown(input, 'Escape').defaultPrevented).toBe(true);

    await until(fixture, () => expect(inputOf(fixture)).toBeNull());
    await until(fixture, () =>
      expect(document.activeElement).toBe(row(fixture).querySelector('.trigger')),
    );
    expect(store.onRename).not.toHaveBeenCalled();
    expect(titleOf(fixture)).toBe('Trip planning');
  });

  it('keeps the editor open, with the typed value, when the rename is rejected', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createStore();
    const failure = new Error('offline');
    store.onRename.mockRejectedValueOnce(failure);
    const fixture = await mount(store);
    const input = await startRename(fixture);
    type(input, 'Trip notes');

    keydown(input, 'Enter');

    await until(fixture, () => expect(error).toHaveBeenCalledWith(expect.any(String), failure));
    await settle(fixture);
    expect(inputOf(fixture)).toBe(input);
    expect(input.value).toBe('Trip notes');
    expect(document.activeElement).toBe(input);

    // It can be tried again.
    keydown(input, 'Enter');
    await until(fixture, () => expect(inputOf(fixture)).toBeNull());
    expect(store.onRename).toHaveBeenCalledTimes(2);
    expect(titleOf(fixture)).toBe('Trip notes');
  });

  it('renames once when Enter is followed by the blur of the input going away', async () => {
    let finish!: () => void;
    const store = createStore();
    store.onRename.mockImplementationOnce(async (id, title) => {
      await new Promise<void>((resolve) => (finish = resolve));
      store.threads.update((list) => list.map((t) => (t.id === id ? { ...t, title } : t)));
    });
    const fixture = await mount(store);
    const input = await startRename(fixture);
    type(input, 'Trip notes');

    keydown(input, 'Enter');
    keydown(input, 'Enter');
    input.blur();
    await vi.waitFor(() => expect(store.onRename).toHaveBeenCalledOnce());
    finish();

    await until(fixture, () => expect(inputOf(fixture)).toBeNull());
    expect(store.onRename).toHaveBeenCalledOnce();
  });

  it('leaves Enter and Escape to an open IME composition', async () => {
    const store = createStore();
    const fixture = await mount(store);
    const input = await startRename(fixture);
    type(input, 'とりっぷ');

    expect(keydown(input, 'Enter', { isComposing: true }).defaultPrevented).toBe(false);
    expect(keydown(input, 'Escape', { keyCode: 229 }).defaultPrevented).toBe(false);
    await settle(fixture);

    expect(inputOf(fixture)).toBe(input);
    expect(store.onRename).not.toHaveBeenCalled();
  });

  it('lets a capture-phase keydown listener veto Enter and Escape', async () => {
    const store = createStore();
    const fixture = await mount(store);
    const input = await startRename(fixture);
    type(input, 'Trip notes');
    row(fixture).addEventListener('keydown', (event) => event.preventDefault(), { capture: true });

    keydown(input, 'Enter');
    keydown(input, 'Escape');
    await settle(fixture);

    expect(inputOf(fixture)).toBe(input);
    expect(store.onRename).not.toHaveBeenCalled();
  });

  it('does not start when the rename button is vetoed or disabled', async () => {
    const store = createStore();
    const fixture = await mount(store);
    fixture.componentInstance.disabled.set(true);
    await settle(fixture);
    const rename = row(fixture).querySelector<HTMLButtonElement>('.rename')!;
    expect(rename.disabled).toBe(true);
    expect(rename.type).toBe('button');
    click(rename);
    await settle(fixture);
    expect(inputOf(fixture)).toBeNull();

    fixture.componentInstance.disabled.set(false);
    await settle(fixture);
    row(fixture).addEventListener('click', (event) => event.preventDefault(), { capture: true });
    click(rename);
    await settle(fixture);
    expect(inputOf(fixture)).toBeNull();
  });

  it('can be started from the item UI state, as a menu does', async () => {
    const store = createStore();
    const fixture = await mount(store);
    const ui = fixture.debugElement
      .queryAll((element) => element.name === 'nxa-test-ui')
      .map((element) => element.componentInstance as ItemUi);

    ui[1]!.ui.isRenaming.set(true);
    await settle(fixture);

    expect(inputOf(fixture, 't1')!.value).toBe('Groceries');
    expect(inputOf(fixture, 't0')).toBeNull();
  });

  it('starts afresh when editing starts again before the input is removed', async () => {
    const store = createStore();
    const fixture = await mount(store);
    const input = await startRename(fixture);
    type(input, 'Trip planning');

    // A touch on the rename button: the input loses the focus, then the button is clicked, in
    // the same task.
    input.blur();
    click(row(fixture).querySelector('.rename')!);
    await settle(fixture);

    expect(inputOf(fixture)).toBe(input);
    type(input, 'Trip notes');
    keydown(input, 'Enter');
    await until(fixture, () => expect(inputOf(fixture)).toBeNull());
    expect(store.onRename).toHaveBeenCalledExactlyOnceWith('t0', 'Trip notes');
  });

  it('keeps the focus where the user moved it while the rename was pending', async () => {
    let finish!: () => void;
    const store = createStore();
    store.onRename.mockImplementationOnce(async (id, title) => {
      await new Promise<void>((resolve) => (finish = resolve));
      store.threads.update((list) => list.map((t) => (t.id === id ? { ...t, title } : t)));
    });
    const fixture = await mount(store);
    const input = await startRename(fixture);
    type(input, 'Trip notes');
    keydown(input, 'Enter');
    await vi.waitFor(() => expect(store.onRename).toHaveBeenCalledOnce());

    const other = row(fixture, 't1').querySelector<HTMLButtonElement>('.trigger')!;
    other.focus();
    finish();

    await until(fixture, () => expect(titleOf(fixture)).toBe('Trip notes'));
    await settle(fixture);
    expect(document.activeElement).toBe(other);
  });

  it('settles quietly when the row goes away while the rename is pending', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let finish!: () => void;
    const store = createStore();
    store.onRename.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    const fixture = await mount(store);
    const input = await startRename(fixture);
    type(input, 'Trip notes');
    keydown(input, 'Enter');
    await vi.waitFor(() => expect(store.onRename).toHaveBeenCalledOnce());

    store.threads.update((list) => list.filter((t) => t.id !== 't0'));
    await settle(fixture);
    expect(row(fixture)).toBeNull();
    finish();
    await settle(fixture);

    expect(error).not.toHaveBeenCalled();
  });

  it('works with an input that stays in the DOM, outside the item root', async () => {
    const store = createStore();
    const fixture = await mount(store, LooseList);
    const input = inputOf(fixture)!;
    const trigger = row(fixture).querySelector<HTMLButtonElement>('.trigger')!;

    keydown(input, 'Escape');
    await until(fixture, () => expect(document.activeElement).toBe(trigger));

    type(input, 'stale');
    click(row(fixture).querySelector('.rename')!);
    await settle(fixture);
    expect(input.value).toBe('Trip planning');
    expect(document.activeElement).toBe(input);

    type(input, 'Trip notes');
    keydown(input, 'Enter');
    await vi.waitFor(() =>
      expect(store.onRename).toHaveBeenCalledExactlyOnceWith('t0', 'Trip notes'),
    );
    await until(fixture, () => expect(document.activeElement).toBe(trigger));
  });

  it('shows *nxaThreadListItemIf content by the item state', async () => {
    const store = createStore();
    const fixture = await mount(store);
    expect(row(fixture, 't0').querySelector('.main')).not.toBeNull();
    expect(row(fixture, 't1').querySelector('.main')).toBeNull();

    store.threadId.set('t1');
    await settle(fixture);

    expect(row(fixture, 't0').querySelector('.main')).toBeNull();
    expect(row(fixture, 't1').querySelector('.main')).not.toBeNull();
  });
});
