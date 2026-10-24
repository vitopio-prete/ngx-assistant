import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Type,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  ChatModelAdapter,
  ExternalStoreAdapter,
  MessageRuntime,
  ThreadMessageLike,
  ThreadRuntime,
} from '@ngx-assistant/engine';
import { provideExternalStoreRuntime } from '../external-store-runtime';
import { fromRuntime } from '../from-runtime';
import { provideLocalRuntime } from '../local-runtime';
import {
  injectComposer,
  injectMessage,
  injectMessageUi,
  injectPart,
  injectThread,
  type MessageUiState,
} from '../scopes';
import { NxaMessageIf, type NxaMessageIfConditions } from './message-if';
import { NxaMessageParts } from './message-parts';
import { NxaMessageRoot } from './message-root';
import { NxaMessages } from './messages';
import { NxaThreadEmpty, NxaThreadIf } from './thread-if';

const waitFor = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true));

const text = (id: string, value: string, role: ThreadMessageLike['role'] = 'user') =>
  ({ id, role, content: [{ type: 'text', text: value }] }) satisfies ThreadMessageLike;

const assistant = (id: string, content: ThreadMessageLike['content']): ThreadMessageLike => ({
  id,
  role: 'assistant',
  content,
  status: { type: 'complete', reason: 'stop' },
});

const toolCall = (toolCallId: string, extra: Record<string, unknown> = {}) => ({
  type: 'tool-call' as const,
  toolCallId,
  toolName: 'get_weather',
  args: { city: 'Berlin' },
  argsText: '{"city":"Berlin"}',
  ...extra,
});

/** An external store whose messages and run state are signals. */
function createStore(initial: readonly ThreadMessageLike[] = []) {
  const messages = signal<readonly ThreadMessageLike[]>(initial);
  const isRunning = signal(false);
  const isDisabled = signal(false);
  const isLoading = signal(false);
  const callbacks = {
    onNew: vi.fn(async () => undefined),
    onEdit: vi.fn<(message: unknown) => Promise<void>>(async () => undefined),
    onAddToolResult: vi.fn(),
    onResumeToolCall: vi.fn(),
    onRespondToToolApproval: vi.fn(),
  };
  const provider = provideExternalStoreRuntime<ThreadMessageLike>(() =>
    computed((): ExternalStoreAdapter<ThreadMessageLike> => ({
      messages: messages(),
      isRunning: isRunning(),
      isDisabled: isDisabled(),
      isLoading: isLoading(),
      convertMessage: (message) => message,
      ...callbacks,
    })),
  );
  return { messages, isRunning, isDisabled, isLoading, provider, ...callbacks };
}

type Store = ReturnType<typeof createStore>;

/** Runs change detection until the adapter effect and the rows it causes have settled. */
async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await fixture.whenStable();
}

function render<T>(component: Type<T>) {
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  return fixture;
}

const rows = (fixture: ComponentFixture<unknown>, selector = 'li') =>
  Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(selector));

const textOf = (rows: HTMLElement[]) => rows.map((row) => row.textContent?.trim());

/** Counts the live subscriptions of every message runtime the thread hands out. */
function countMessageSubscriptions(thread: ThreadRuntime) {
  let live = 0;
  const getMessageById = thread.getMessageById.bind(thread);
  vi.spyOn(thread, 'getMessageById').mockImplementation((id) => {
    const runtime = getMessageById(id);
    const subscribe = runtime.subscribe.bind(runtime);
    return Object.assign(Object.create(runtime) as MessageRuntime, {
      subscribe: (callback: () => void) => {
        live++;
        const unsubscribe = subscribe(callback);
        return () => {
          live--;
          unsubscribe();
        };
      },
    });
  });
  return () => live;
}

const lifecycle = { mounts: 0, destroys: 0 };

@Component({
  selector: 'nxa-test-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ text() }}`,
})
class Row {
  private readonly message = injectMessage();
  protected readonly text = fromRuntime(this.message, (s) =>
    s.content.map((part) => (part.type === 'text' ? part.text : '')).join(''),
  );
  readonly composer = injectComposer();
  readonly state = signal('');

  constructor() {
    lifecycle.mounts++;
    inject(DestroyRef).onDestroy(() => lifecycle.destroys++);
  }
}

function messagesHost(store: Store) {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NxaMessages, Row],
    providers: [store.provider],
    template: `
      <ul>
        <li
          *nxaMessages="
            let message;
            let i = index;
            let count = count;
            let first = first;
            let last = last
          "
          [attr.data-id]="message().id"
          [attr.data-role]="message().role"
          [attr.data-position]="i + '/' + count + (first ? ' first' : '') + (last ? ' last' : '')"
        >
          <nxa-test-row />
        </li>
      </ul>
    `,
  })
  class Host {
    readonly thread = injectThread();
  }
  return Host;
}

beforeEach(() => {
  lifecycle.mounts = 0;
  lifecycle.destroys = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('nxaMessages', () => {
  it('renders one message scope per message, with the edit composer as its composer', async () => {
    const store = createStore([text('u0', 'hello'), text('a0', 'hi there', 'assistant')]);
    const fixture = render(messagesHost(store));
    await settle(fixture);

    expect(textOf(rows(fixture))).toEqual(['hello', 'hi there']);
    expect(rows(fixture).map((row) => row.dataset['role'])).toEqual(['user', 'assistant']);
    expect(rows(fixture).map((row) => row.dataset['position'])).toEqual(['0/2 first', '1/2 last']);
    const composer = fixture.debugElement.query((el) => el.name === 'nxa-test-row')
      .componentInstance.composer;
    expect(composer.getState().type).toBe('edit');
    expect(composer).not.toBe(fixture.componentInstance.thread.composer);
  });

  it('keeps a row for an update in place and creates one for a new id', async () => {
    const store = createStore([text('u1', 'hello')]);
    const fixture = render(messagesHost(store));
    await settle(fixture);
    expect(lifecycle.mounts).toBe(1);

    store.messages.set([text('u1', 'hello edited in place')]);
    await settle(fixture);
    expect(textOf(rows(fixture))).toEqual(['hello edited in place']);
    expect(lifecycle).toEqual({ mounts: 1, destroys: 0 });

    store.messages.set([text('u2', 'replaced occupant')]);
    await settle(fixture);
    expect(rows(fixture).map((row) => row.dataset['id'])).toEqual(['u2']);
    expect(textOf(rows(fixture))).toEqual(['replaced occupant']);
    expect(lifecycle).toEqual({ mounts: 2, destroys: 1 });
  });

  it('keeps the sibling rows when a message in the middle is removed', async () => {
    const store = createStore([text('a', 'first'), text('b', 'second'), text('c', 'third')]);
    const fixture = render(messagesHost(store));
    await settle(fixture);
    const [rowA, , rowC] = rows(fixture);

    store.messages.set([text('a', 'first'), text('c', 'third')]);
    await settle(fixture);

    expect(rows(fixture)).toEqual([rowA, rowC]);
    expect(rowC!.dataset['position']).toBe('1/2 last');
    expect(lifecycle).toEqual({ mounts: 3, destroys: 1 });
  });

  it('moves a row with its message and updates its index', async () => {
    const store = createStore([text('a', 'first'), text('b', 'second')]);
    const fixture = render(messagesHost(store));
    await settle(fixture);
    const [rowA, rowB] = rows(fixture);
    const rowState = fixture.debugElement
      .queryAll((el) => el.name === 'nxa-test-row')
      .map((el) => el.componentInstance as Row);
    rowState[1]!.state.set('kept');

    store.messages.set([text('z', 'prepended'), text('b', 'second'), text('a', 'first')]);
    await settle(fixture);

    const [, movedB, movedA] = rows(fixture);
    expect(movedB).toBe(rowB);
    expect(movedA).toBe(rowA);
    expect(textOf(rows(fixture))).toEqual(['prepended', 'second', 'first']);
    expect(rows(fixture).map((row) => row.dataset['position'])).toEqual([
      '0/3 first',
      '1/3',
      '2/3 last',
    ]);
    expect(rowState[1]!.state()).toBe('kept');
  });

  it('keeps reading a message removed under its row until the row goes, without errors', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createStore([text('gone', 'text')]);
    const fixture = render(messagesHost(store));
    await settle(fixture);
    const live = countMessageSubscriptions(fixture.componentInstance.thread);

    store.messages.set([text('u0', 'kept'), text('u1', 'another')]);
    await settle(fixture);
    expect(live()).toBeGreaterThan(0);

    store.messages.set([]);
    await settle(fixture);
    expect(rows(fixture)).toHaveLength(0);
    expect(live()).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });

  it('keeps the optimistic reply row mounted while the store updates during a run', async () => {
    const store = createStore();
    const fixture = render(messagesHost(store));
    await settle(fixture);

    store.messages.set([text('u1', 'question')]);
    store.isRunning.set(true);
    await settle(fixture);
    expect(rows(fixture).map((row) => row.dataset['role'])).toEqual(['user', 'assistant']);
    const mounts = lifecycle.mounts;

    store.messages.set([text('u1', 'question')]);
    await settle(fixture);
    store.messages.set([text('u1', 'question')]);
    await settle(fixture);
    expect(rows(fixture)).toHaveLength(2);
    expect(lifecycle.mounts).toBe(mounts);
  });

  it('replaces a reply with an empty one without errors', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createStore([
      text('u0', 'question'),
      assistant('a0', [{ type: 'text', text: 'answer' }]),
    ]);
    const fixture = render(messagesHost(store));
    await settle(fixture);

    store.messages.set([text('u0', 'question'), assistant('a0', [])]);
    await settle(fixture);

    expect(textOf(rows(fixture))).toEqual(['question', '']);
    expect(error).not.toHaveBeenCalled();
  });

  it('edits a message through the edit composer of its row', async () => {
    const store = createStore([text('u0', 'original')]);
    const fixture = render(messagesHost(store));
    await settle(fixture);
    const composer = fixture.debugElement.query((el) => el.name === 'nxa-test-row')
      .componentInstance.composer;

    expect(composer.getState().isEditing).toBe(false);
    composer.beginEdit();
    expect(composer.getState().text).toBe('original');
    composer.setText('edited');
    composer.send();

    await waitFor(() => store.onEdit.mock.calls.length === 1);
    expect(store.onEdit.mock.calls[0]![0]).toMatchObject({
      content: [{ type: 'text', text: 'edited' }],
    });
  });

  it('removes every row and its subscriptions when it is destroyed', async () => {
    const store = createStore();
    const fixture = render(messagesHost(store));
    await settle(fixture);
    const live = countMessageSubscriptions(fixture.componentInstance.thread);
    store.messages.set([text('a', 'first'), text('b', 'second')]);
    await settle(fixture);
    expect(live()).toBeGreaterThan(0);

    fixture.destroy();
    expect(live()).toBe(0);
    expect(lifecycle).toEqual({ mounts: 2, destroys: 2 });
  });
});

@Component({
  selector: 'nxa-test-part',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ label() }}`,
})
class Part {
  readonly part = injectPart();
  protected readonly label = fromRuntime(this.part, (s) =>
    s.type === 'text' ? s.text : s.type === 'tool-call' ? s.toolCallId : s.type,
  );
  readonly state = signal('');

  constructor() {
    lifecycle.mounts++;
    inject(DestroyRef).onDestroy(() => lifecycle.destroys++);
  }
}

function partsHost(store: Store) {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NxaMessages, NxaMessageParts, Part],
    providers: [store.provider],
    template: `
      <section *nxaMessages="let message">
        <p
          *nxaMessageParts="let part; let i = index"
          [attr.data-type]="part().type"
          [attr.data-status]="part().status.type"
          [attr.data-index]="i"
        >
          @let p = part();
          @switch (p.type) {
            @case ('text') {
              <span [attr.data-text]="p.text"></span>
            }
          }
          <nxa-test-part />
        </p>
      </section>
    `,
  })
  class Host {}
  return Host;
}

const partOf = (fixture: ComponentFixture<unknown>, index: number) =>
  fixture.debugElement.queryAll((el) => el.name === 'nxa-test-part')[index]!
    .componentInstance as Part;

describe('nxaMessageParts', () => {
  it('renders the parts of the message with their status', async () => {
    const store = createStore([
      assistant('a0', [
        { type: 'reasoning', text: 'thinking it through' },
        { type: 'text', text: 'The weather is sunny.' },
        toolCall('call-1'),
      ]),
    ]);
    const fixture = render(partsHost(store));
    await settle(fixture);

    const parts = rows(fixture, 'p');
    expect(parts.map((part) => part.dataset['type'])).toEqual(['reasoning', 'text', 'tool-call']);
    expect(textOf(parts)).toEqual(['reasoning', 'The weather is sunny.', 'call-1']);
    expect(parts.every((part) => part.dataset['status'] !== undefined)).toBe(true);
  });

  it('updates a part in place, in the same row', async () => {
    const store = createStore([assistant('a0', [{ type: 'text', text: 'first' }])]);
    const fixture = render(partsHost(store));
    await settle(fixture);
    const [row] = rows(fixture, 'p');

    store.messages.set([assistant('a0', [{ type: 'text', text: 'second' }])]);
    await settle(fixture);

    expect(rows(fixture, 'p')).toEqual([row]);
    expect(textOf(rows(fixture, 'p'))).toEqual(['second']);
    expect(lifecycle).toEqual({ mounts: 1, destroys: 0 });
  });

  it('creates the row again when the part at a position changes type', async () => {
    const store = createStore([assistant('a0', [{ type: 'text', text: 'first' }])]);
    const fixture = render(partsHost(store));
    await settle(fixture);

    store.messages.set([assistant('a0', [{ type: 'reasoning', text: 'now reasoning' }])]);
    await settle(fixture);

    expect(rows(fixture, 'p').map((part) => part.dataset['type'])).toEqual(['reasoning']);
    expect(lifecycle).toEqual({ mounts: 2, destroys: 1 });
  });

  it('keeps the row of a tool call with the call when the parts are reordered', async () => {
    const store = createStore([assistant('a0', [toolCall('call-a'), toolCall('call-b')])]);
    const fixture = render(partsHost(store));
    await settle(fixture);
    partOf(fixture, 0).state.set('state of a');
    const [rowA, rowB] = rows(fixture, 'p');

    store.messages.set([assistant('a0', [toolCall('call-b'), toolCall('call-a')])]);
    await settle(fixture);

    expect(rows(fixture, 'p')).toEqual([rowB, rowA]);
    expect(textOf(rows(fixture, 'p'))).toEqual(['call-b', 'call-a']);
    expect(rows(fixture, 'p').map((part) => part.dataset['index'])).toEqual(['0', '1']);
    expect(partOf(fixture, 1).state()).toBe('state of a');
    expect(lifecycle.mounts).toBe(2);
  });

  it('routes the tool call actions to the call of the row', async () => {
    const store = createStore([
      assistant('a0', [toolCall('call-1'), toolCall('call-2', { approval: { id: 'appr-1' } })]),
    ]);
    const fixture = render(partsHost(store));
    await settle(fixture);
    const second = partOf(fixture, 1).part;

    second.addToolResult({ temperature: 21 });
    expect(store.onAddToolResult).toHaveBeenCalledTimes(1);
    expect(store.onAddToolResult.mock.calls[0]![0]).toMatchObject({ toolCallId: 'call-2' });

    second.resumeToolCall({ answer: 'yes' });
    expect(store.onResumeToolCall).toHaveBeenCalledTimes(1);
    expect(store.onResumeToolCall.mock.calls[0]![0]).toMatchObject({ toolCallId: 'call-2' });

    await second.respondToToolApproval({ approved: true });
    expect(store.onRespondToToolApproval).toHaveBeenCalledTimes(1);
  });

  it('removes the row of a part that goes away, without errors', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createStore([
      assistant('a0', [
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two' },
      ]),
    ]);
    const fixture = render(partsHost(store));
    await settle(fixture);

    store.messages.set([assistant('a0', [{ type: 'text', text: 'one' }])]);
    await settle(fixture);

    expect(textOf(rows(fixture, 'p'))).toEqual(['one']);
    expect(lifecycle).toEqual({ mounts: 2, destroys: 1 });
    expect(error).not.toHaveBeenCalled();
  });

  it('falls back to positions for tool calls that share an id', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createStore([assistant('a0', [toolCall('dup'), toolCall('dup')])]);
    const fixture = render(partsHost(store));
    await settle(fixture);
    const [first, second] = rows(fixture, 'p');

    store.messages.set([assistant('a0', [toolCall('dup'), toolCall('dup'), toolCall('own')])]);
    await settle(fixture);

    expect(rows(fixture, 'p').slice(0, 2)).toEqual([first, second]);
    expect(textOf(rows(fixture, 'p'))).toEqual(['dup', 'dup', 'own']);
    expect(error).not.toHaveBeenCalled();
  });

  it('updates the status of a part in the same row', async () => {
    const running: ThreadMessageLike = {
      ...assistant('a0', [{ type: 'text', text: 'partial' }]),
      status: { type: 'running' },
    };
    const store = createStore([text('u0', 'question'), running]);
    store.isRunning.set(true);
    const fixture = render(partsHost(store));
    await settle(fixture);
    const [row] = rows(fixture, 'p').slice(-1);
    expect(row!.dataset['status']).toBe('running');

    store.messages.set([
      text('u0', 'question'),
      assistant('a0', [{ type: 'text', text: 'partial and done' }]),
    ]);
    store.isRunning.set(false);
    await settle(fixture);

    expect(rows(fixture, 'p').slice(-1)).toEqual([row]);
    expect(row!.dataset['status']).toBe('complete');
    expect(row!.querySelector('span')!.dataset['text']).toBe('partial and done');
  });

  it('needs a message scope', () => {
    @Component({
      imports: [NxaMessageParts],
      providers: [createStore().provider],
      template: `<p *nxaMessageParts="let part">{{ part().type }}</p>`,
    })
    class Host {}
    expect(() => render(Host)).toThrow(/No message scope/);
  });
});

@Component({
  selector: 'nxa-test-ui',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
class UiProbe {
  readonly ui = injectMessageUi();
}

function rootHost(store: Store) {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NxaMessages, NxaMessageRoot, UiProbe],
    providers: [store.provider],
    template: `
      @if (show()) {
        <article *nxaMessages="let message" nxaMessageRoot><nxa-test-ui /></article>
      }
    `,
  })
  class Host {
    readonly show = signal(true);
  }
  return Host;
}

const uiOf = (fixture: ComponentFixture<unknown>, index = 0): MessageUiState =>
  fixture.debugElement.queryAll((el) => el.name === 'nxa-test-ui')[index]!.componentInstance.ui;

describe('nxaMessageRoot', () => {
  it('sets the message id and tracks the hover', async () => {
    const store = createStore([text('u0', 'hello'), text('u1', 'again')]);
    const fixture = render(rootHost(store));
    await settle(fixture);
    const [first, second] = rows(fixture, 'article');
    expect([first!.dataset['nxaMessageId'], second!.dataset['nxaMessageId']]).toEqual(['u0', 'u1']);

    first!.dispatchEvent(new MouseEvent('mouseenter'));
    expect(uiOf(fixture, 0).isHovering()).toBe(true);
    expect(uiOf(fixture, 1).isHovering()).toBe(false);

    first!.dispatchEvent(new MouseEvent('mouseleave'));
    expect(uiOf(fixture, 0).isHovering()).toBe(false);
  });

  it('starts hovered when the pointer is already over it', async () => {
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      return selector === ':hover' && this.tagName === 'ARTICLE';
    });
    const store = createStore([text('u0', 'hello')]);
    const fixture = render(rootHost(store));
    await settle(fixture);

    expect(uiOf(fixture).isHovering()).toBe(true);
  });

  it('clears the hover when it is destroyed and does not set it again', async () => {
    const store = createStore([text('u0', 'hello')]);
    const fixture = render(rootHost(store));
    await settle(fixture);
    const [article] = rows(fixture, 'article');
    article!.dispatchEvent(new MouseEvent('mouseenter'));
    const ui = uiOf(fixture);
    expect(ui.isHovering()).toBe(true);

    fixture.componentInstance.show.set(false);
    await settle(fixture);
    expect(ui.isHovering()).toBe(false);

    article!.dispatchEvent(new MouseEvent('mouseenter'));
    expect(ui.isHovering()).toBe(false);
  });
});

function ifHost(store: Store, when: NxaMessageIfConditions) {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NxaMessages, NxaMessageIf, NxaMessageRoot, UiProbe],
    providers: [store.provider],
    template: `
      <article *nxaMessages="let message" nxaMessageRoot [attr.data-id]="message().id">
        <nxa-test-ui />
        <span *nxaMessageIf="when(); else other" class="shown">{{ message().id }}</span>
        <ng-template #other
          ><span class="other">{{ message().id }}</span></ng-template
        >
      </article>
    `,
  })
  class Host {
    readonly when = signal(when);
  }
  return Host;
}

const shown = (fixture: ComponentFixture<unknown>) => textOf(rows(fixture, '.shown'));

const roles = ['user', 'assistant', 'system'] as const;
const byRole: ThreadMessageLike[] = [
  text('u', 'u'),
  text('a', 'a', 'assistant'),
  text('s', 's', 'system'),
];

describe('nxaMessageIf', () => {
  const renderIf = async (when: NxaMessageIfConditions, messages = byRole) => {
    const store = createStore(messages);
    const fixture = render(ifHost(store, when));
    await settle(fixture);
    return { fixture, store };
  };

  it.each(roles)('%s: true renders only that role', async (role) => {
    const { fixture } = await renderIf({ [role]: true });
    expect(shown(fixture)).toEqual([role[0]]);
  });

  it.each(roles)('%s: false renders every other role', async (role) => {
    const { fixture } = await renderIf({ [role]: false });
    expect(shown(fixture)).toEqual(roles.filter((r) => r !== role).map((r) => r[0]));
  });

  it.each(roles)('%s: undefined renders every role', async (role) => {
    const { fixture } = await renderIf({ [role]: undefined });
    expect(shown(fixture)).toEqual(['u', 'a', 's']);
  });

  it('combines a true condition with a false one', async () => {
    const { fixture } = await renderIf({ assistant: false, system: false });
    expect(shown(fixture)).toEqual(['u']);
  });

  it('renders the else template while the conditions fail', async () => {
    const { fixture } = await renderIf({ user: true });
    expect(textOf(rows(fixture, '.other'))).toEqual(['a', 's']);
  });

  it('follows the last message', async () => {
    const { fixture, store } = await renderIf({ last: true }, [
      text('u0', 'one'),
      text('u1', 'two'),
    ]);
    expect(shown(fixture)).toEqual(['u1']);

    store.messages.set([text('u0', 'one'), text('u1', 'two'), text('u2', 'three')]);
    await settle(fixture);
    expect(shown(fixture)).toEqual(['u2']);
    expect(textOf(rows(fixture, '.other'))).toEqual(['u0', 'u1']);
  });

  it('shows on the last message or while the pointer is over a message', async () => {
    const { fixture } = await renderIf({ lastOrHover: true }, [
      text('u0', 'one'),
      text('u1', 'two'),
    ]);
    expect(shown(fixture)).toEqual(['u1']);

    rows(fixture, 'article')[0]!.dispatchEvent(new MouseEvent('mouseenter'));
    await settle(fixture);
    expect(shown(fixture)).toEqual(['u0', 'u1']);

    rows(fixture, 'article')[0]!.dispatchEvent(new MouseEvent('mouseleave'));
    await settle(fixture);
    expect(shown(fixture)).toEqual(['u1']);
  });

  it('follows the copied state of the message', async () => {
    const { fixture } = await renderIf({ copied: true }, [text('u0', 'one'), text('u1', 'two')]);
    expect(shown(fixture)).toEqual([]);

    uiOf(fixture, 1).isCopied.set(true);
    await settle(fixture);
    expect(shown(fixture)).toEqual(['u1']);

    fixture.componentInstance.when.set({ copied: false });
    await settle(fixture);
    expect(shown(fixture)).toEqual(['u0']);
  });

  it('checks the content, the attachments and the submitted feedback', async () => {
    const messages: ThreadMessageLike[] = [
      {
        id: 'with-file',
        role: 'user',
        content: [{ type: 'text', text: 'see file' }],
        attachments: [
          {
            id: 'f',
            type: 'document',
            name: 'f.txt',
            contentType: 'text/plain',
            status: { type: 'complete' },
            content: [],
          },
        ],
      },
      { ...assistant('empty', []) },
      {
        ...assistant('liked', [{ type: 'text', text: 'ok' }]),
        metadata: { submittedFeedback: { type: 'positive' } },
      },
    ];
    const { fixture } = await renderIf({ hasAttachments: true }, messages);
    expect(shown(fixture)).toEqual(['with-file']);

    fixture.componentInstance.when.set({ hasContent: false });
    await settle(fixture);
    expect(shown(fixture)).toEqual(['empty']);

    fixture.componentInstance.when.set({ submittedFeedback: 'positive' });
    await settle(fixture);
    expect(shown(fixture)).toEqual(['liked']);

    fixture.componentInstance.when.set({ submittedFeedback: null, hasContent: true });
    await settle(fixture);
    expect(shown(fixture)).toEqual(['with-file']);
  });

  it('renders every message for no conditions, and none with hasBranches on single branches', async () => {
    const { fixture } = await renderIf({});
    expect(shown(fixture)).toEqual(['u', 'a', 's']);

    fixture.componentInstance.when.set({ hasBranches: true });
    await settle(fixture);
    expect(shown(fixture)).toEqual([]);
  });
});

function threadIfHost(store: Store) {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NxaThreadIf, NxaThreadEmpty],
    providers: [store.provider],
    template: `
      <p *nxaThreadEmpty class="empty">empty</p>
      <p *nxaThreadIf="{ running: true }; else idle" class="running">running</p>
      <ng-template #idle><p class="idle">idle</p></ng-template>
      <p *nxaThreadIf="{ disabled: true, empty: false }" class="disabled">disabled</p>
    `,
  })
  class Host {}
  return Host;
}

describe('nxaThreadIf and nxaThreadEmpty', () => {
  const visible = (fixture: ComponentFixture<unknown>) => textOf(rows(fixture, 'p'));

  it('follow the thread state', async () => {
    const store = createStore();
    const fixture = render(threadIfHost(store));
    await settle(fixture);
    expect(visible(fixture)).toEqual(['empty', 'idle']);

    store.isLoading.set(true);
    await settle(fixture);
    expect(visible(fixture)).toEqual(['idle']);
    store.isLoading.set(false);

    store.messages.set([text('u0', 'hello')]);
    store.isRunning.set(true);
    await settle(fixture);
    expect(visible(fixture)).toEqual(['running']);

    store.isRunning.set(false);
    store.isDisabled.set(true);
    await settle(fixture);
    expect(visible(fixture)).toEqual(['idle', 'disabled']);
  });
});

/** Streams one chunk and waits for the abort on the first run; answers at once afterwards. */
const cancellableModel = (): ChatModelAdapter => {
  let runs = 0;
  return {
    async *run({ abortSignal }) {
      if (runs++ > 0) {
        yield { content: [{ type: 'text', text: 'second answer' }] };
        return;
      }
      yield { content: [{ type: 'text', text: 'partial' }] };
      await new Promise((resolve) => abortSignal.addEventListener('abort', resolve));
    },
  };
};

describe('message primitives over a running thread', () => {
  it('follow a stream, its cancel, a reload and a branch switch', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaMessages, NxaMessageParts, NxaMessageIf],
      providers: [provideLocalRuntime(cancellableModel())],
      template: `
        <article *nxaMessages="let message" [attr.data-role]="message().role">
          <p *nxaMessageParts="let part">
            @let p = part();
            @if (p.type === 'text') {
              {{ p.text }}
            }
          </p>
          <span *nxaMessageIf="{ hasBranches: true }" class="branches">
            {{ message().branchNumber }}/{{ message().branchCount }}
          </span>
        </article>
      `,
    })
    class Host {
      readonly thread = injectThread();
    }
    const fixture = render(Host);
    const thread = fixture.componentInstance.thread;
    const replies = () => textOf(rows(fixture, 'article[data-role="assistant"] p'));

    thread.append('question');
    await waitFor(() => thread.getState().isRunning);
    await settle(fixture);
    await waitFor(() => {
      fixture.detectChanges();
      return replies()[0] === 'partial';
    });
    const streamed = rows(fixture, 'article')[1];

    thread.cancelRun();
    await waitFor(() => !thread.getState().isRunning);
    await settle(fixture);
    expect(rows(fixture, 'article')[1]).toBe(streamed);
    expect(replies()).toEqual(['partial']);

    thread.getMessageByIndex(1).reload();
    await waitFor(
      () =>
        !thread.getState().isRunning &&
        thread.getState().messages[1]?.content.length === 1 &&
        (thread.getState().messages[1]!.content[0] as { text: string }).text === 'second answer',
    );
    await settle(fixture);
    expect(replies()).toEqual(['second answer']);
    expect(textOf(rows(fixture, '.branches'))).toEqual(['2/2']);

    thread.getMessageByIndex(1).switchToBranch({ position: 'previous' });
    await settle(fixture);
    expect(replies()).toEqual(['partial']);
    expect(textOf(rows(fixture, '.branches'))).toEqual(['1/2']);
    expect(rows(fixture, 'article')).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
  });
});
