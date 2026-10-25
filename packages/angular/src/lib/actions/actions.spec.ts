import {
  ChangeDetectionStrategy,
  Component,
  Provider,
  Type,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  ChatModelAdapter,
  ExternalStoreAdapter,
  RuntimeCapabilities,
  ThreadMessageLike,
  ThreadRuntime,
  ThreadState,
} from '@ngx-assistant/engine';
import { NxaComposerCancel } from '../composer/composer-cancel';
import { NxaComposerIf } from '../composer/composer-if';
import { NxaComposerInput } from '../composer/composer-input';
import { NxaComposerRoot } from '../composer/composer-root';
import { NxaComposerSend } from '../composer/composer-send';
import { provideExternalStoreRuntime } from '../external-store-runtime';
import { provideLocalRuntime } from '../local-runtime';
import { NxaMessageIf } from '../messages/message-if';
import { NxaMessageRoot } from '../messages/message-root';
import { NxaMessages } from '../messages/messages';
import {
  NXA_ASSISTANT,
  NXA_MESSAGE_UI,
  NXA_THREAD,
  injectMessageUi,
  injectThread,
  provideMessageScope,
  type MessageUiState,
} from '../scopes';
import { NxaActionBarCopy, type NxaCopyToClipboard } from './action-bar-copy';
import { NxaActionBarEdit } from './action-bar-edit';
import { NxaActionBarReload } from './action-bar-reload';
import {
  NxaActionBarRoot,
  type NxaActionBarAutohide,
  type NxaActionBarAutohideFloat,
} from './action-bar-root';
import {
  NxaBranchPickerCount,
  NxaBranchPickerNext,
  NxaBranchPickerNumber,
  NxaBranchPickerPrevious,
  NxaBranchPickerRoot,
} from './branch-picker';

const text = (id: string, value: string, role: ThreadMessageLike['role'] = 'user') =>
  ({ id, role, content: [{ type: 'text', text: value }] }) satisfies ThreadMessageLike;

const assistant = (
  id: string,
  content: ThreadMessageLike['content'],
  status: ThreadMessageLike['status'] = { type: 'complete', reason: 'stop' },
): ThreadMessageLike => ({ id, role: 'assistant', content, status });

const flush = () => new Promise<void>((resolve) => setTimeout(resolve));

const click = (target: Element) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
  target.dispatchEvent(event);
  return event;
};

const type = (textarea: HTMLTextAreaElement, value: string) => {
  textarea.value = value;
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
};

/** A model that echoes the last user message and numbers its runs. */
function echoModel() {
  let runs = 0;
  const model: ChatModelAdapter = {
    async *run({ messages }) {
      runs++;
      const last = [...messages].reverse().find((message) => message.role === 'user');
      const said = last?.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
      yield { content: [{ type: 'text', text: `Echo: ${said} #${runs}` }] };
    },
  };
  return model;
}

/** A model that streams one chunk and then waits until the run is aborted. */
const blockingModel = (): ChatModelAdapter => ({
  async *run({ abortSignal }) {
    yield { content: [{ type: 'text', text: 'partial' }] };
    await new Promise((resolve) => abortSignal.addEventListener('abort', resolve));
  },
});

const seeded: ThreadMessageLike[] = [
  text('u1', 'hello'),
  assistant('a1', [{ type: 'text', text: 'Echo: hello' }]),
];

/** An external store whose messages and run state are signals. */
function createStore(
  initial: readonly ThreadMessageLike[] = seeded,
  extra: Partial<ExternalStoreAdapter<ThreadMessageLike>> = {},
) {
  const messages = signal<readonly ThreadMessageLike[]>(initial);
  const isRunning = signal(false);
  const isDisabled = signal(false);
  const onEdit = vi.fn(async () => undefined);
  const onReload = vi.fn(async () => undefined);
  const provider = provideExternalStoreRuntime<ThreadMessageLike>(() =>
    computed((): ExternalStoreAdapter<ThreadMessageLike> => ({
      messages: messages(),
      isRunning: isRunning(),
      isDisabled: isDisabled(),
      convertMessage: (message) => message,
      onNew: async () => undefined,
      onEdit,
      onReload,
      ...extra,
    })),
  );
  return { messages, isRunning, isDisabled, onEdit, onReload, provider };
}

/** Wraps the main thread so that its state reports other capabilities, or other fields. */
function threadWithCapabilities(
  patch: Partial<RuntimeCapabilities>,
  fields: Partial<ThreadState> = {},
): Provider {
  return {
    provide: NXA_THREAD,
    useFactory: () => {
      const thread = inject(NXA_ASSISTANT)!.thread;
      let source: ThreadState | undefined;
      let patched: ThreadState | undefined;
      return Object.assign(Object.create(thread) as ThreadRuntime, {
        getState: () => {
          const state = thread.getState();
          if (state !== source) {
            source = state;
            patched = { ...state, ...fields, capabilities: { ...state.capabilities, ...patch } };
          }
          return patched!;
        },
      });
    },
  };
}

let writer: NxaCopyToClipboard | null = null;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaMessages,
    NxaMessageRoot,
    NxaMessageIf,
    NxaComposerIf,
    NxaComposerRoot,
    NxaComposerInput,
    NxaComposerSend,
    NxaComposerCancel,
    NxaActionBarRoot,
    NxaActionBarCopy,
    NxaActionBarEdit,
    NxaActionBarReload,
    NxaBranchPickerRoot,
    NxaBranchPickerPrevious,
    NxaBranchPickerNext,
    NxaBranchPickerNumber,
    NxaBranchPickerCount,
  ],
  template: `
    <article
      *nxaMessages="let message"
      nxaMessageRoot
      class="msg"
      [attr.data-role]="message().role"
    >
      <ng-template #view>
        <span class="text">{{ textOf(message().content) }}</span>
      </ng-template>
      <form *nxaComposerIf="{ editing: true }; else view" nxaComposerRoot class="editor">
        <textarea nxaComposerInput aria-label="Edit message"></textarea>
        <button nxaComposerCancel class="cancel">Cancel</button>
        <button nxaComposerSend class="send">Save</button>
      </form>
      <span *nxaMessageIf="{ copied: true }" class="probe">copied</span>
      <div
        nxaActionBarRoot
        #bar="nxaActionBarRoot"
        class="bar"
        [autohide]="autohide()"
        [autohideFloat]="autohideFloat()"
        [hideWhenRunning]="hideWhenRunning()"
        [attr.data-status]="bar.status()"
      >
        <button
          nxaActionBarCopy
          class="copy"
          [copiedDuration]="300"
          [copyToClipboard]="copy"
          [disabled]="disabled()"
        >
          Copy
        </button>
        <button nxaActionBarEdit class="edit" [disabled]="disabled()">Edit</button>
        <button nxaActionBarReload class="reload" [disabled]="disabled()">Reload</button>
      </div>
      <div nxaBranchPickerRoot class="picker" [hideWhenSingleBranch]="hideWhenSingleBranch()">
        <button nxaBranchPickerPrevious class="prev" [disabled]="disabled()">‹</button>
        <span class="pos"
          ><span nxaBranchPickerNumber></span>/<span nxaBranchPickerCount></span
        ></span>
        <button nxaBranchPickerNext class="next" [disabled]="disabled()">›</button>
      </div>
    </article>
  `,
})
class Chat {
  readonly thread = injectThread();
  readonly autohide = signal<NxaActionBarAutohide>('never');
  readonly autohideFloat = signal<NxaActionBarAutohideFloat>('never');
  readonly hideWhenRunning = signal(false);
  readonly hideWhenSingleBranch = signal(false);
  readonly disabled = signal(false);
  protected readonly copy = writer;

  protected textOf(content: readonly { type: string; text?: string }[]) {
    return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
  }
}

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await fixture.whenStable();
}

async function mount(providers: Provider[], component: Type<unknown> = Chat) {
  TestBed.configureTestingModule({ providers });
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  await settle(fixture);
  return fixture as ComponentFixture<Chat>;
}

/** Waits until `check` passes, letting the runtime and change detection run in between. */
const until = (fixture: ComponentFixture<unknown>, check: () => void) =>
  vi.waitFor(async () => {
    await fixture.whenStable();
    check();
  });

const msgs = (fixture: ComponentFixture<unknown>) =>
  Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('article.msg'));
const byRole = (fixture: ComponentFixture<unknown>, role: string) =>
  (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
    `article[data-role="${role}"]`,
  )!;
const q = <T extends HTMLElement = HTMLButtonElement>(scope: HTMLElement, selector: string) =>
  scope.querySelector<T>(selector)!;
const textIn = (scope: HTMLElement, selector: string) =>
  scope.querySelector(selector)?.textContent?.trim();

const vetoClicks = (fixture: ComponentFixture<unknown>) =>
  (fixture.nativeElement as HTMLElement).addEventListener(
    'click',
    (event) => event.preventDefault(),
    { capture: true },
  );

beforeEach(() => {
  writer = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('nxaActionBarEdit', () => {
  it('begins the edit of its message, swaps the view for the edit form and disables itself', async () => {
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    const user = byRole(fixture, 'user');
    expect(q(user, 'form.editor')).toBeNull();
    expect(textIn(user, '.text')).toBe('hello');
    expect(q(user, 'button.edit').disabled).toBe(false);

    click(q(user, 'button.edit'));
    await settle(fixture);

    expect(q(user, '.text')).toBeNull();
    expect(q<HTMLTextAreaElement>(user, 'textarea').value).toBe('hello');
    expect(q(user, 'button.edit').disabled).toBe(true);
    expect(q(byRole(fixture, 'assistant'), 'form.editor')).toBeNull();
  });

  it('discards the edit through the cancel button and shows the message again', async () => {
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    const user = byRole(fixture, 'user');
    click(q(user, 'button.edit'));
    await settle(fixture);
    type(q<HTMLTextAreaElement>(user, 'textarea'), 'goodbye');

    click(q(user, 'button.cancel'));
    await settle(fixture);

    expect(q(user, 'form.editor')).toBeNull();
    expect(textIn(user, '.text')).toBe('hello');
    expect(q(user, 'button.edit').disabled).toBe(false);
    expect(textIn(user, '.pos')).toBe('1/1');
  });

  it('is disabled while the thread is disabled or cannot edit', async () => {
    const store = createStore();
    const fixture = await mount([store.provider]);
    const edit = () => q(byRole(fixture, 'user'), 'button.edit');
    expect(edit().disabled).toBe(false);

    store.isDisabled.set(true);
    await settle(fixture);
    expect(edit().disabled).toBe(true);
    click(edit());
    await settle(fixture);
    expect(q(byRole(fixture, 'user'), 'form.editor')).toBeNull();

    TestBed.resetTestingModule();
    const noEdit = createStore(seeded, { onEdit: undefined });
    const other = await mount([noEdit.provider]);
    expect(q(byRole(other, 'user'), 'button.edit').disabled).toBe(true);
  });

  it('edit and reload are disabled during a voice session', async () => {
    const fixture = await mount([
      ...provideLocalRuntime(echoModel(), { initialMessages: seeded }),
      threadWithCapabilities(
        {},
        { voice: { status: { type: 'running' } } as ThreadState['voice'] },
      ),
    ]);
    expect(q(byRole(fixture, 'user'), 'button.edit').disabled).toBe(true);
    expect(q(byRole(fixture, 'assistant'), 'button.reload').disabled).toBe(true);
    expect(q(byRole(fixture, 'assistant'), 'button.copy').disabled).toBe(false);
  });

  it('respects a capture-phase veto and the disabled input', async () => {
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    const user = byRole(fixture, 'user');

    fixture.componentInstance.disabled.set(true);
    await settle(fixture);
    expect(q(user, 'button.edit').disabled).toBe(true);

    fixture.componentInstance.disabled.set(false);
    await settle(fixture);
    vetoClicks(fixture);
    click(q(user, 'button.edit'));
    await settle(fixture);
    expect(q(user, 'form.editor')).toBeNull();
  });
});

describe('nxaActionBarReload', () => {
  it('regenerates an assistant message as a new branch and stays disabled on user messages', async () => {
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    expect(q(byRole(fixture, 'user'), 'button.reload').disabled).toBe(true);
    const reload = q(byRole(fixture, 'assistant'), 'button.reload');
    expect(reload.disabled).toBe(false);

    click(reload);
    await until(fixture, () =>
      expect(textIn(byRole(fixture, 'assistant'), '.text')).toBe('Echo: hello #1'),
    );
    expect(textIn(byRole(fixture, 'assistant'), '.pos')).toBe('2/2');
    expect(msgs(fixture)).toHaveLength(2);
  });

  it('is disabled during a run, on a disabled thread, and without reload support', async () => {
    const store = createStore();
    const fixture = await mount([store.provider]);
    const reload = () => q(byRole(fixture, 'assistant'), 'button.reload');
    expect(reload().disabled).toBe(false);

    store.isRunning.set(true);
    await settle(fixture);
    expect(reload().disabled).toBe(true);
    click(reload());

    store.isRunning.set(false);
    store.isDisabled.set(true);
    await settle(fixture);
    expect(reload().disabled).toBe(true);
    click(reload());
    await flush();
    expect(store.onReload).not.toHaveBeenCalled();

    store.isDisabled.set(false);
    await settle(fixture);
    click(reload());
    await vi.waitFor(() => expect(store.onReload).toHaveBeenCalledTimes(1));

    TestBed.resetTestingModule();
    const noReload = createStore(seeded, { onReload: undefined });
    const other = await mount([noReload.provider]);
    expect(q(byRole(other, 'assistant'), 'button.reload').disabled).toBe(true);
  });

  it('respects a capture-phase veto', async () => {
    const store = createStore();
    const fixture = await mount([store.provider]);
    vetoClicks(fixture);
    click(q(byRole(fixture, 'assistant'), 'button.reload'));
    await flush();
    expect(store.onReload).not.toHaveBeenCalled();
  });
});

describe('nxaActionBarCopy', () => {
  const uiOf = (fixture: ComponentFixture<unknown>, role: string): MessageUiState =>
    fixture.debugElement
      .query((el) => el.nativeElement === byRole(fixture, role))
      .injector.get(NXA_MESSAGE_UI)!;

  it('copies the message text and keeps it copied for the configured window', async () => {
    const write = Promise.resolve();
    writer = vi.fn(() => write);
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    const item = byRole(fixture, 'assistant');
    const copy = q(item, 'button.copy');
    expect(copy.disabled).toBe(false);

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    click(copy);
    expect(writer).toHaveBeenCalledWith('Echo: hello');
    await write;
    fixture.detectChanges();
    expect(copy.hasAttribute('data-nxa-copied')).toBe(true);
    expect(q(item, '.probe')).not.toBeNull();
    expect(q(byRole(fixture, 'user'), '.probe')).toBeNull();

    vi.advanceTimersByTime(299);
    fixture.detectChanges();
    expect(copy.hasAttribute('data-nxa-copied')).toBe(true);

    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(copy.hasAttribute('data-nxa-copied')).toBe(false);
    expect(q(item, '.probe')).toBeNull();
  });

  it('restarts the window on a second copy', async () => {
    writer = vi.fn(async () => undefined);
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    const copy = q(byRole(fixture, 'assistant'), 'button.copy');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    click(copy);
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(200);
    click(copy);
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    expect(copy.hasAttribute('data-nxa-copied')).toBe(true);
    vi.advanceTimersByTime(100);
    fixture.detectChanges();
    expect(copy.hasAttribute('data-nxa-copied')).toBe(false);
  });

  it('copies the edit draft while the message is being edited', async () => {
    writer = vi.fn(async () => undefined);
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    const user = byRole(fixture, 'user');
    click(q(user, 'button.edit'));
    await settle(fixture);
    type(q<HTMLTextAreaElement>(user, 'textarea'), 'draft edit');
    await settle(fixture);

    click(q(user, 'button.copy'));
    expect(writer).toHaveBeenCalledWith('draft edit');
  });

  it('is disabled while an assistant message runs or when a message has no text', async () => {
    writer = vi.fn(async () => undefined);
    const store = createStore([
      text('u1', 'question'),
      assistant('a1', [{ type: 'text', text: 'partial' }], { type: 'running' }),
    ]);
    const fixture = await mount([store.provider]);
    const copy = () => q(byRole(fixture, 'assistant'), 'button.copy');
    expect(q(byRole(fixture, 'user'), 'button.copy').disabled).toBe(false);
    expect(copy().disabled).toBe(true);
    click(copy());
    expect(writer).not.toHaveBeenCalled();

    store.messages.set([text('u1', 'question'), assistant('a1', [{ type: 'text', text: 'done' }])]);
    await settle(fixture);
    expect(copy().disabled).toBe(false);

    store.messages.set([text('u1', 'question'), assistant('a1', [{ type: 'text', text: '' }])]);
    await settle(fixture);
    expect(copy().disabled).toBe(true);

    store.messages.set([
      text('u1', 'question'),
      assistant('a1', [{ type: 'reasoning', text: 'only thoughts' }]),
    ]);
    await settle(fixture);
    expect(copy().disabled).toBe(true);
  });

  it('leaves the message alone when the write rejects or throws', async () => {
    writer = vi.fn(() => Promise.reject(new Error('denied')));
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    const copy = q(byRole(fixture, 'assistant'), 'button.copy');
    click(copy);
    await flush();
    await settle(fixture);
    expect(copy.hasAttribute('data-nxa-copied')).toBe(false);

    (writer as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('sync failure');
    });
    expect(() => click(copy)).not.toThrow();
    await flush();
    await settle(fixture);
    expect(copy.hasAttribute('data-nxa-copied')).toBe(false);
  });

  it('writes through navigator.clipboard by default, and stays inert without it', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    const copy = q(byRole(fixture, 'assistant'), 'button.copy');
    click(copy);
    expect(writeText).toHaveBeenCalledWith('Echo: hello');
    await until(fixture, () => expect(copy.hasAttribute('data-nxa-copied')).toBe(true));

    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const user = q(byRole(fixture, 'user'), 'button.copy');
    expect(() => click(user)).not.toThrow();
    await flush();
    await settle(fixture);
    expect(user.hasAttribute('data-nxa-copied')).toBe(false);
  });

  it('keeps the copied state on its message when history is added before it', async () => {
    const write = Promise.resolve();
    writer = () => write;
    const store = createStore([assistant('a1', [{ type: 'text', text: 'reply' }])]);
    const fixture = await mount([store.provider]);
    const copy = q(byRole(fixture, 'assistant'), 'button.copy');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    click(copy);
    await write;
    fixture.detectChanges();
    expect(copy.hasAttribute('data-nxa-copied')).toBe(true);

    store.messages.set([
      text('older', 'earlier question'),
      assistant('a1', [{ type: 'text', text: 'reply' }]),
    ]);
    fixture.detectChanges();
    expect(q(byRole(fixture, 'assistant'), 'button.copy')).toBe(copy);
    expect(copy.hasAttribute('data-nxa-copied')).toBe(true);
    expect(q(byRole(fixture, 'user'), '.probe')).toBeNull();

    vi.advanceTimersByTime(300);
    fixture.detectChanges();
    expect(copy.hasAttribute('data-nxa-copied')).toBe(false);
  });

  it('ignores a write that completes after its message row is gone', async () => {
    let resolveWrite!: () => void;
    writer = vi.fn(() => new Promise<void>((resolve) => (resolveWrite = resolve)));
    const store = createStore();
    const fixture = await mount([store.provider]);
    const ui = uiOf(fixture, 'assistant');
    click(q(byRole(fixture, 'assistant'), 'button.copy'));

    store.messages.set([text('u1', 'hello'), assistant('a9', [{ type: 'text', text: 'other' }])]);
    await settle(fixture);
    resolveWrite();
    await flush();
    await settle(fixture);

    expect(ui.isCopied()).toBe(false);
    expect(q(byRole(fixture, 'assistant'), 'button.copy').hasAttribute('data-nxa-copied')).toBe(
      false,
    );
  });

  it('ends the copied window when it is destroyed', async () => {
    writer = vi.fn(async () => undefined);
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    const ui = uiOf(fixture, 'assistant');
    click(q(byRole(fixture, 'assistant'), 'button.copy'));
    await until(fixture, () => expect(ui.isCopied()).toBe(true));

    fixture.destroy();
    expect(ui.isCopied()).toBe(false);
  });

  it('drops a write pending across destroy', async () => {
    let resolveWrite!: () => void;
    writer = vi.fn(() => new Promise<void>((resolve) => (resolveWrite = resolve)));
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    const ui = uiOf(fixture, 'assistant');
    click(q(byRole(fixture, 'assistant'), 'button.copy'));
    fixture.destroy();
    resolveWrite();
    await flush();
    expect(ui.isCopied()).toBe(false);
  });

  it('respects a capture-phase veto and the disabled input', async () => {
    writer = vi.fn(async () => undefined);
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    const copy = q(byRole(fixture, 'assistant'), 'button.copy');
    fixture.componentInstance.disabled.set(true);
    await settle(fixture);
    expect(copy.disabled).toBe(true);

    fixture.componentInstance.disabled.set(false);
    await settle(fixture);
    vetoClicks(fixture);
    click(copy);
    expect(writer).not.toHaveBeenCalled();
  });

  it('resets when its scope moves to another message', async () => {
    let resolveWrite!: () => void;
    const write = vi.fn(() => new Promise<void>((resolve) => (resolveWrite = resolve)));

    @Component({
      selector: 'nxa-test-first',
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaActionBarCopy],
      providers: [provideMessageScope(() => inject(NXA_THREAD)!.getMessageByIndex(0))],
      template: `<button nxaActionBarCopy [copiedDuration]="60000" [copyToClipboard]="write">
        Copy
      </button>`,
    })
    class First {
      readonly ui = injectMessageUi();
      protected readonly write = write;
    }
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [First],
      template: `<nxa-test-first />`,
    })
    class Host {}

    const store = createStore([text('u1', 'first')]);
    const fixture = await mount([store.provider], Host);
    const first = fixture.debugElement.children[0]!.componentInstance as First;
    const button = (fixture.nativeElement as HTMLElement).querySelector('button')!;

    click(button);
    resolveWrite();
    await until(fixture, () => expect(first.ui.isCopied()).toBe(true));

    click(button);
    store.messages.set([text('u0', 'prepended'), text('u1', 'first')]);
    await settle(fixture);
    expect(first.ui.isCopied()).toBe(false);

    resolveWrite();
    await flush();
    await settle(fixture);
    expect(first.ui.isCopied()).toBe(false);
    expect(write).toHaveBeenLastCalledWith('first');
  });

  it('ignores a write that completes right after its scope moved, before change detection', async () => {
    let resolveWrite!: () => void;
    const write = vi.fn(() => new Promise<void>((resolve) => (resolveWrite = resolve)));

    @Component({
      selector: 'nxa-test-first',
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaActionBarCopy],
      providers: [provideMessageScope(() => inject(NXA_THREAD)!.getMessageByIndex(0))],
      template: `<button nxaActionBarCopy [copyToClipboard]="write">Copy</button>`,
    })
    class First {
      readonly ui = injectMessageUi();
      readonly thread = injectThread();
      protected readonly write = write;
    }
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [First],
      template: `<nxa-test-first />`,
    })
    class Host {}

    const fixture = await mount(
      provideLocalRuntime(echoModel(), { initialMessages: [text('u1', 'first')] }),
      Host,
    );
    const first = fixture.debugElement.children[0]!.componentInstance as First;
    click((fixture.nativeElement as HTMLElement).querySelector('button')!);

    first.thread.reset([text('u2', 'other')]);
    resolveWrite();
    await Promise.resolve();
    await Promise.resolve();
    expect(first.ui.isCopied()).toBe(false);
  });

  it('shares the copied state between the copy buttons of a message', async () => {
    writer = vi.fn(async () => undefined);
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaMessages, NxaActionBarCopy],
      template: `
        <article *nxaMessages="let message" [attr.data-role]="message().role">
          <button nxaActionBarCopy class="a" [copyToClipboard]="copy">A</button>
          @if (second()) {
            <button nxaActionBarCopy class="b" [copyToClipboard]="copy">B</button>
          }
        </article>
      `,
    })
    class Two {
      readonly second = signal(true);
      protected readonly copy = writer;
    }
    const fixture = await mount(
      provideLocalRuntime(echoModel(), { initialMessages: seeded }),
      Two as Type<unknown>,
    );
    const item = byRole(fixture, 'assistant');
    click(q(item, 'button.a'));
    await until(fixture, () =>
      expect(q(item, 'button.b').hasAttribute('data-nxa-copied')).toBe(true),
    );

    // Destroying a button that opened no window leaves the other one's window alone.
    (fixture.componentInstance as unknown as Two).second.set(false);
    await settle(fixture);
    expect(q(item, 'button.a').hasAttribute('data-nxa-copied')).toBe(true);
  });
});

describe('nxaActionBarRoot', () => {
  const status = (fixture: ComponentFixture<unknown>, role: string) => {
    const bar = q<HTMLElement>(byRole(fixture, role), '.bar');
    return {
      status: bar.dataset['status'],
      hidden: bar.hasAttribute('hidden'),
      floating: bar.hasAttribute('data-nxa-floating'),
    };
  };
  const hover = async (fixture: ComponentFixture<unknown>, role: string, value: boolean) => {
    byRole(fixture, role).dispatchEvent(new MouseEvent(value ? 'mouseenter' : 'mouseleave'));
    await settle(fixture);
  };

  it('stays visible by default', async () => {
    const fixture = await mount([createStore().provider]);
    expect(status(fixture, 'user')).toEqual({ status: 'normal', hidden: false, floating: false });
  });

  it('autohide always: hidden until the pointer is over the message', async () => {
    const fixture = await mount([createStore().provider]);
    fixture.componentInstance.autohide.set('always');
    await settle(fixture);
    expect(status(fixture, 'assistant')).toEqual({
      status: 'hidden',
      hidden: true,
      floating: false,
    });

    await hover(fixture, 'assistant', true);
    expect(status(fixture, 'assistant')).toEqual({
      status: 'normal',
      hidden: false,
      floating: false,
    });

    await hover(fixture, 'assistant', false);
    expect(status(fixture, 'assistant').hidden).toBe(true);
  });

  it('autohide not-last: the last message keeps its bar, the others show it on hover', async () => {
    const fixture = await mount([createStore().provider]);
    fixture.componentInstance.autohide.set('not-last');
    await settle(fixture);
    expect(status(fixture, 'assistant').status).toBe('normal');
    expect(status(fixture, 'user').status).toBe('hidden');

    await hover(fixture, 'user', true);
    expect(status(fixture, 'user').status).toBe('normal');
  });

  it('floats an auto-hidden bar shown by the hover', async () => {
    const fixture = await mount([createStore().provider]);
    fixture.componentInstance.autohide.set('always');
    fixture.componentInstance.autohideFloat.set('always');
    await settle(fixture);
    await hover(fixture, 'user', true);
    expect(status(fixture, 'user')).toEqual({ status: 'floating', hidden: false, floating: true });

    fixture.componentInstance.autohide.set('never');
    await settle(fixture);
    expect(status(fixture, 'user').floating).toBe(false);
  });

  it('floats only single-branch messages with autohideFloat single-branch', async () => {
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    fixture.componentInstance.autohide.set('always');
    fixture.componentInstance.autohideFloat.set('single-branch');
    await settle(fixture);
    await hover(fixture, 'assistant', true);
    expect(status(fixture, 'assistant').status).toBe('floating');

    click(q(byRole(fixture, 'assistant'), 'button.reload'));
    await until(fixture, () => expect(textIn(byRole(fixture, 'assistant'), '.pos')).toBe('2/2'));
    await hover(fixture, 'assistant', true);
    expect(status(fixture, 'assistant').status).toBe('normal');
  });

  it('hides while the thread runs with hideWhenRunning', async () => {
    const store = createStore();
    const fixture = await mount([store.provider]);
    store.isRunning.set(true);
    await settle(fixture);
    expect(status(fixture, 'user').hidden).toBe(false);
    store.isRunning.set(false);
    await settle(fixture);

    fixture.componentInstance.hideWhenRunning.set(true);
    await settle(fixture);
    expect(status(fixture, 'user').hidden).toBe(false);

    store.isRunning.set(true);
    await settle(fixture);
    expect(status(fixture, 'user').hidden).toBe(true);
    await hover(fixture, 'user', true);
    expect(status(fixture, 'user').hidden).toBe(true);

    store.isRunning.set(false);
    await settle(fixture);
    expect(status(fixture, 'user').hidden).toBe(false);
  });
});

describe('branch picker', () => {
  const editTo = async (fixture: ComponentFixture<Chat>, value: string) => {
    const user = byRole(fixture, 'user');
    click(q(user, 'button.edit'));
    await settle(fixture);
    type(q<HTMLTextAreaElement>(user, 'textarea'), value);
    click(q(user, 'button.send'));
  };

  it('navigates the branches that an edit creates', async () => {
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    expect(textIn(byRole(fixture, 'user'), '.pos')).toBe('1/1');
    expect(q(byRole(fixture, 'user'), 'button.prev').disabled).toBe(true);
    expect(q(byRole(fixture, 'user'), 'button.next').disabled).toBe(true);

    await editTo(fixture, 'goodbye');
    await until(fixture, () => {
      expect(textIn(byRole(fixture, 'user'), '.pos')).toBe('2/2');
      expect(textIn(byRole(fixture, 'assistant'), '.text')).toBe('Echo: goodbye #1');
    });
    expect(textIn(byRole(fixture, 'user'), '.text')).toBe('goodbye');
    expect(q(byRole(fixture, 'user'), 'button.next').disabled).toBe(true);
    expect(q(byRole(fixture, 'user'), 'button.prev').disabled).toBe(false);

    click(q(byRole(fixture, 'user'), 'button.prev'));
    await until(fixture, () => expect(textIn(byRole(fixture, 'user'), '.pos')).toBe('1/2'));
    expect(textIn(byRole(fixture, 'user'), '.text')).toBe('hello');
    expect(textIn(byRole(fixture, 'assistant'), '.text')).toBe('Echo: hello');
    expect(q(byRole(fixture, 'user'), 'button.prev').disabled).toBe(true);
    expect(q(byRole(fixture, 'user'), 'button.next').disabled).toBe(false);

    click(q(byRole(fixture, 'user'), 'button.next'));
    await until(fixture, () => expect(textIn(byRole(fixture, 'user'), '.pos')).toBe('2/2'));
    expect(textIn(byRole(fixture, 'user'), '.text')).toBe('goodbye');
  });

  it('hides a single-branch picker with hideWhenSingleBranch', async () => {
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    const picker = () => q<HTMLElement>(byRole(fixture, 'user'), '.picker');
    expect(picker().hasAttribute('hidden')).toBe(false);

    fixture.componentInstance.hideWhenSingleBranch.set(true);
    await settle(fixture);
    expect(picker().hasAttribute('hidden')).toBe(true);

    await editTo(fixture, 'goodbye');
    await until(fixture, () => expect(picker().hasAttribute('hidden')).toBe(false));
  });

  it('switches during a run only when the runtime allows it', async () => {
    const initialMessages: ThreadMessageLike[] = [
      text('u1', 'hello'),
      assistant('a1', [{ type: 'text', text: 'one' }]),
    ];
    const allowed = await mount(provideLocalRuntime(blockingModel(), { initialMessages }));
    click(q(byRole(allowed, 'assistant'), 'button.reload'));
    await until(allowed, () => expect(textIn(byRole(allowed, 'assistant'), '.pos')).toBe('2/2'));
    expect(allowed.componentInstance.thread.getState().isRunning).toBe(true);
    expect(q(byRole(allowed, 'assistant'), 'button.prev').disabled).toBe(false);
    allowed.componentInstance.thread.cancelRun();
    allowed.destroy();

    TestBed.resetTestingModule();
    const blocked = await mount([
      ...provideLocalRuntime(blockingModel(), { initialMessages }),
      threadWithCapabilities({ switchBranchDuringRun: false }),
    ]);
    click(q(byRole(blocked, 'assistant'), 'button.reload'));
    await until(blocked, () => expect(textIn(byRole(blocked, 'assistant'), '.pos')).toBe('2/2'));
    const prev = q(byRole(blocked, 'assistant'), 'button.prev');
    expect(prev.disabled).toBe(true);
    click(prev);
    await settle(blocked);
    expect(textIn(byRole(blocked, 'assistant'), '.pos')).toBe('2/2');

    blocked.componentInstance.thread.cancelRun();
    await until(blocked, () => expect(prev.disabled).toBe(false));
  });

  it('is disabled when the thread cannot switch branches', async () => {
    const fixture = await mount([
      ...provideLocalRuntime(echoModel(), { initialMessages: seeded }),
      threadWithCapabilities({ switchToBranch: false }),
    ]);
    click(q(byRole(fixture, 'assistant'), 'button.reload'));
    await until(fixture, () => expect(textIn(byRole(fixture, 'assistant'), '.pos')).toBe('2/2'));
    expect(q(byRole(fixture, 'assistant'), 'button.prev').disabled).toBe(true);
  });

  it('respects a capture-phase veto and the disabled input', async () => {
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    click(q(byRole(fixture, 'assistant'), 'button.reload'));
    await until(fixture, () => expect(textIn(byRole(fixture, 'assistant'), '.pos')).toBe('2/2'));
    const prev = q(byRole(fixture, 'assistant'), 'button.prev');

    fixture.componentInstance.disabled.set(true);
    await settle(fixture);
    expect(prev.disabled).toBe(true);

    fixture.componentInstance.disabled.set(false);
    await settle(fixture);
    vetoClicks(fixture);
    click(prev);
    await settle(fixture);
    expect(textIn(byRole(fixture, 'assistant'), '.pos')).toBe('2/2');
  });
});

@Component({ changeDetection: ChangeDetectionStrategy.OnPush, template: `` })
class Outside {}

describe('message action primitives', () => {
  it.each([
    ['nxaActionBarRoot', '<div nxaActionBarRoot></div>', NxaActionBarRoot],
    ['nxaActionBarCopy', '<button nxaActionBarCopy></button>', NxaActionBarCopy],
    ['nxaActionBarEdit', '<button nxaActionBarEdit></button>', NxaActionBarEdit],
    ['nxaActionBarReload', '<button nxaActionBarReload></button>', NxaActionBarReload],
    ['nxaBranchPickerRoot', '<div nxaBranchPickerRoot></div>', NxaBranchPickerRoot],
    [
      'nxaBranchPickerPrevious',
      '<button nxaBranchPickerPrevious></button>',
      NxaBranchPickerPrevious,
    ],
    ['nxaBranchPickerNext', '<button nxaBranchPickerNext></button>', NxaBranchPickerNext],
    ['nxaBranchPickerNumber', '<span nxaBranchPickerNumber></span>', NxaBranchPickerNumber],
    ['nxaBranchPickerCount', '<span nxaBranchPickerCount></span>', NxaBranchPickerCount],
  ])('%s needs a message scope', (_name, template, directive) => {
    TestBed.configureTestingModule({ providers: provideLocalRuntime(echoModel()) });
    TestBed.overrideComponent(Outside, { set: { imports: [directive], template } });
    expect(() => TestBed.createComponent(Outside).detectChanges()).toThrow(/No message scope/);
  });

  it('set type="button" on their buttons', async () => {
    const fixture = await mount(provideLocalRuntime(echoModel(), { initialMessages: seeded }));
    const buttons = Array.from(
      byRole(fixture, 'assistant').querySelectorAll<HTMLButtonElement>(
        '.bar button, .picker button',
      ),
    );
    expect(buttons).toHaveLength(5);
    expect(buttons.every((button) => button.type === 'button')).toBe(true);
  });
});
