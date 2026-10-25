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
  AttachmentAdapter,
  AttachmentRuntime,
  ChatModelAdapter,
  CompleteAttachment,
  CreateAttachment,
  ComposerRuntime,
  ExternalStoreAdapter,
  ThreadMessageLike,
} from '@ngx-assistant/engine';
import { provideExternalStoreRuntime } from '../external-store-runtime';
import { fromRuntime } from '../from-runtime';
import { provideLocalRuntime } from '../local-runtime';
import { NxaMessages } from '../messages';
import {
  injectAssistant,
  injectAttachment,
  injectComposer,
  injectThread,
  provideAttachmentScope,
} from '../scopes';
import { NxaAttachmentRemove } from './attachment-remove';
import { NxaAttachmentRoot } from './attachment-root';
import { getAttachmentKeys } from './attachment-row';
import { NxaAttachmentThumb, getAttachmentLabel } from './attachment-thumb';
import { NxaComposerAddAttachment } from './composer-add-attachment';
import { NxaComposerAttachmentDropzone } from './composer-attachment-dropzone';
import { NxaComposerAttachments } from './composer-attachments';
import { NxaMessageAttachments } from './message-attachments';

const model: ChatModelAdapter = {
  async *run() {
    yield { content: [{ type: 'text', text: 'reply' }] };
  },
};

const attachmentAdapter = (): AttachmentAdapter => ({
  accept: 'text/plain,image/*',
  async add({ file }) {
    if (file.name.startsWith('broken')) throw new Error('upload failed');
    return {
      id: file.name,
      type: file.type.startsWith('image/') ? 'image' : 'document',
      name: file.name,
      contentType: file.type,
      file,
      status: { type: 'requires-action', reason: 'composer-send' },
    };
  },
  async send(attachment) {
    return { ...attachment, status: { type: 'complete' }, content: [] };
  },
  async remove() {
    return undefined;
  },
});

const file = (name: string, type = 'text/plain') => new File(['x'], name, { type });
const flush = () => new Promise<void>((resolve) => setTimeout(resolve));
const waitFor = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true));

const click = (target: Element) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

/** Vetoes `type` events below `root` with a capture-phase listener. */
const veto = (root: Element, type: string) =>
  root.addEventListener(type, (event) => event.preventDefault(), { capture: true });

const completeAttachment = (id: string, name = `${id}.txt`): CompleteAttachment => ({
  id,
  type: 'document',
  name,
  contentType: 'text/plain',
  status: { type: 'complete' },
  content: [{ type: 'text', text: id }],
});

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await fixture.whenStable();
}

function render<T>(component: Type<T>) {
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  return fixture;
}

const all = (fixture: ComponentFixture<unknown>, selector: string) =>
  Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(selector));

const one = (fixture: ComponentFixture<unknown>, selector: string) =>
  (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector)!;

const lifecycle = { mounts: 0, destroys: 0 };

/** A row with state of its own: the name of the attachment it was created for. */
@Component({
  selector: 'nxa-test-attachment',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ initialName }}={{ name() }}`,
})
class AttachmentRow {
  private readonly attachment = injectAttachment();
  readonly initialName = this.attachment.getState().name;
  protected readonly name = fromRuntime(this.attachment, (s) => s.name);

  constructor() {
    lifecycle.mounts++;
    inject(DestroyRef).onDestroy(() => lifecycle.destroys++);
  }
}

/** An external store whose messages are a signal. */
function createStore(initial: readonly ThreadMessageLike[] = []) {
  const messages = signal<readonly ThreadMessageLike[]>(initial);
  const isDisabled = signal(false);
  const threadId = signal('thread-a');
  const provider = provideExternalStoreRuntime<ThreadMessageLike>(() =>
    computed((): ExternalStoreAdapter<ThreadMessageLike> => ({
      messages: messages(),
      isDisabled: isDisabled(),
      convertMessage: (message) => message,
      onNew: async () => undefined,
      onEdit: async () => undefined,
      adapters: {
        attachments: attachmentAdapter(),
        threadList: { threadId: threadId(), onSwitchToNewThread: () => undefined },
      },
    })),
  );
  return { messages, isDisabled, threadId, provider };
}

const user = (id: string, attachments?: CompleteAttachment[]): ThreadMessageLike => ({
  id,
  role: 'user',
  content: [{ type: 'text', text: id }],
  ...(attachments ? { attachments } : {}),
});

beforeEach(() => {
  lifecycle.mounts = 0;
  lifecycle.destroys = 0;
});

afterEach(() => {
  document.querySelectorAll('input[type="file"]').forEach((input) => input.remove());
  vi.restoreAllMocks();
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaComposerAttachments, NxaAttachmentRoot, NxaAttachmentRemove, AttachmentRow],
  providers: [provideLocalRuntime(model, { adapters: { attachments: attachmentAdapter() } })],
  template: `
    <ul>
      <li
        *nxaComposerAttachments="let attachment; let i = index; let count = count; let last = last"
        nxaAttachmentRoot
        [attr.data-position]="i + '/' + count + (last ? ' last' : '')"
      >
        <nxa-test-attachment />
        <button nxaAttachmentRemove>Remove</button>
      </li>
    </ul>
  `,
})
class ComposerHost {
  readonly composer = injectComposer();
  readonly thread = injectThread();
  readonly assistant = injectAssistant();
}

const names = (fixture: ComponentFixture<unknown>) =>
  all(fixture, 'nxa-test-attachment').map((row) => row.textContent);

const draftNames = (composer: ComposerRuntime) =>
  composer.getState().attachments.map((attachment) => attachment.name);

describe('nxaComposerAttachments', () => {
  it('renders one attachment scope per composer attachment', async () => {
    const fixture = render(ComposerHost);
    const { composer } = fixture.componentInstance;
    await composer.addAttachment(file('first.txt'));
    await composer.addAttachment(file('photo.png', 'image/png'));
    await settle(fixture);

    expect(names(fixture)).toEqual(['first.txt=first.txt', 'photo.png=photo.png']);
    expect(all(fixture, 'li').map((row) => row.dataset['position'])).toEqual(['0/2', '1/2 last']);
    const [first, second] = all(fixture, 'li');
    expect(first!.getAttribute('data-nxa-attachment-type')).toBe('document');
    expect(second!.getAttribute('data-nxa-attachment-type')).toBe('image');
    expect(first!.getAttribute('data-nxa-attachment-status')).toBe('requires-action');
    expect(first!.getAttribute('data-nxa-attachment-source')).toBe('thread-composer');
  });

  it('does not reuse row state for a different attachment', async () => {
    const fixture = render(ComposerHost);
    const { composer } = fixture.componentInstance;
    await composer.addAttachment(file('first.txt'));
    await composer.addAttachment(file('second.txt'));
    await settle(fixture);
    expect(lifecycle.mounts).toBe(2);

    await composer.getAttachmentByIndex(0).remove();
    await settle(fixture);

    expect(names(fixture)).toEqual(['second.txt=second.txt']);
    expect(lifecycle).toEqual({ mounts: 2, destroys: 1 });
    expect(all(fixture, 'li')[0]!.dataset['position']).toBe('0/1 last');
  });

  it('removes the attachment of its row after an attachment before it is removed', async () => {
    const fixture = render(ComposerHost);
    const { composer } = fixture.componentInstance;
    for (const name of ['a.txt', 'b.txt', 'c.txt']) await composer.addAttachment(file(name));
    await settle(fixture);

    const [first, second] = all(fixture, 'button');
    click(first!);
    await waitFor(() => draftNames(composer).length === 2);
    // b.txt is now at index 0; its row still removes b.txt, not c.txt at its old index.
    click(second!);
    await waitFor(() => draftNames(composer).length === 1);

    expect(draftNames(composer)).toEqual(['c.txt']);
  });

  it('empties the list when the main thread changes', async () => {
    const store = createStore();
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaComposerAttachments, AttachmentRow],
      providers: [store.provider],
      template: `<nxa-test-attachment *nxaComposerAttachments />`,
    })
    class Host {
      readonly composer = injectComposer();
    }
    const fixture = render(Host);
    const { composer } = fixture.componentInstance;
    await settle(fixture);
    await composer.addAttachment(file('first.txt'));
    await settle(fixture);
    expect(names(fixture)).toHaveLength(1);

    store.threadId.set('thread-b');
    await settle(fixture);

    expect(composer.getState().attachments).toHaveLength(0);
    expect(names(fixture)).toEqual([]);
    expect(lifecycle).toEqual({ mounts: 1, destroys: 1 });
  });
});

describe('nxaComposerAttachments subscriptions', () => {
  it('releases the row subscriptions with the row and the list subscription with the list', async () => {
    let live = 0;
    @Component({
      selector: 'nxa-test-list',
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaComposerAttachments, AttachmentRow],
      template: `<nxa-test-attachment *nxaComposerAttachments />`,
    })
    class List {}

    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [List],
      providers: [provideLocalRuntime(model, { adapters: { attachments: attachmentAdapter() } })],
      template: `@if (shown()) {
        <nxa-test-list />
      }`,
    })
    class Host {
      readonly shown = signal(false);
      readonly composer = injectComposer();
      constructor() {
        const subscribe = this.composer.subscribe;
        vi.spyOn(this.composer, 'subscribe').mockImplementation((callback) => {
          live++;
          const unsubscribe = subscribe(callback);
          return () => {
            live--;
            unsubscribe();
          };
        });
      }
    }

    const fixture = render(Host);
    const { composer } = fixture.componentInstance;
    await composer.addAttachment(file('a.txt'));
    await composer.addAttachment(file('b.txt'));
    fixture.componentInstance.shown.set(true);
    await settle(fixture);
    expect(names(fixture)).toHaveLength(2);
    const withRows = live;
    expect(withRows).toBeGreaterThan(0);

    await composer.getAttachmentByIndex(0).remove();
    await settle(fixture);
    expect(live).toBeLessThan(withRows);

    fixture.componentInstance.shown.set(false);
    await settle(fixture);
    expect(live).toBe(0);
  });
});

describe('nxaMessageAttachments', () => {
  function messageHost(store: ReturnType<typeof createStore>) {
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [
        NxaMessages,
        NxaMessageAttachments,
        NxaAttachmentRoot,
        NxaAttachmentRemove,
        AttachmentRow,
      ],
      providers: [store.provider],
      template: `
        <section *nxaMessages="let message" [attr.data-id]="message().id">
          <p *nxaMessageAttachments="let attachment" nxaAttachmentRoot>
            <nxa-test-attachment />
            <button nxaAttachmentRemove>Remove</button>
          </p>
        </section>
      `,
    })
    class Host {}
    return Host;
  }

  it('treats missing user message attachments as empty', async () => {
    const store = createStore([user('u1')]);
    const fixture = render(messageHost(store));
    await settle(fixture);

    expect(all(fixture, 'section')).toHaveLength(1);
    expect(all(fixture, 'p')).toHaveLength(0);
  });

  it('renders the attachments of a user message, which cannot be removed', async () => {
    const store = createStore([
      user('u1', [completeAttachment('first'), completeAttachment('second')]),
    ]);
    const fixture = render(messageHost(store));
    await settle(fixture);

    expect(names(fixture)).toEqual(['first.txt=first.txt', 'second.txt=second.txt']);
    const [first] = all(fixture, 'p');
    expect(first!.getAttribute('data-nxa-attachment-source')).toBe('message');
    expect(first!.getAttribute('data-nxa-attachment-status')).toBe('complete');
    expect(all(fixture, 'button').every((button) => (button as HTMLButtonElement).disabled)).toBe(
      true,
    );
  });

  it('does not reuse row state for a different attachment', async () => {
    const first = completeAttachment('first');
    const second = completeAttachment('second');
    const store = createStore([user('u1', [first, second])]);
    const fixture = render(messageHost(store));
    await settle(fixture);

    store.messages.set([user('u1', [second])]);
    await settle(fixture);

    expect(names(fixture)).toEqual(['second.txt=second.txt']);
    expect(lifecycle).toEqual({ mounts: 2, destroys: 1 });
  });

  it('keeps row state with its attachment when the attachments are reordered', async () => {
    const first = completeAttachment('first');
    const second = completeAttachment('second');
    const store = createStore([user('u1', [first, second])]);
    const fixture = render(messageHost(store));
    await settle(fixture);

    store.messages.set([user('u1', [second, first])]);
    await settle(fixture);

    expect(names(fixture)).toEqual(['second.txt=second.txt', 'first.txt=first.txt']);
    expect(lifecycle).toEqual({ mounts: 2, destroys: 0 });
  });

  it('follows an attachment that is renamed in place', async () => {
    const store = createStore([user('u1', [completeAttachment('first')])]);
    const fixture = render(messageHost(store));
    await settle(fixture);

    store.messages.set([user('u1', [completeAttachment('first', 'renamed.txt')])]);
    await settle(fixture);

    expect(names(fixture)).toEqual(['first.txt=renamed.txt']);
    expect(lifecycle).toEqual({ mounts: 1, destroys: 0 });
  });

  it('binds attachments with a duplicated id to their position', async () => {
    const store = createStore([
      user('u1', [completeAttachment('same', 'one.txt'), completeAttachment('same', 'two.txt')]),
    ]);
    const fixture = render(messageHost(store));
    await settle(fixture);

    expect(names(fixture)).toEqual(['one.txt=one.txt', 'two.txt=two.txt']);
    expect(getAttachmentKeys([{ id: 'same' }, { id: 'other' }, { id: 'same' }])).toEqual([
      'attachment@0',
      'attachment:other',
      'attachment@2',
    ]);
  });
});

describe('edit composer attachments', () => {
  it('lists and removes the attachments of the edit composer only', async () => {
    const store = createStore([
      user('u1', [completeAttachment('first'), completeAttachment('second')]),
    ]);

    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [
        NxaMessages,
        NxaComposerAttachments,
        NxaAttachmentRoot,
        NxaAttachmentRemove,
        AttachmentRow,
      ],
      providers: [store.provider],
      template: `
        <section *nxaMessages>
          <p *nxaComposerAttachments nxaAttachmentRoot>
            <nxa-test-attachment />
            <button nxaAttachmentRemove>Remove</button>
          </p>
        </section>
      `,
    })
    class Host {
      readonly thread = injectThread();
    }

    const fixture = render(Host);
    await settle(fixture);
    expect(all(fixture, 'p')).toHaveLength(0);

    const message = fixture.componentInstance.thread.getMessageByIndex(0);
    message.composer.beginEdit();
    await settle(fixture);
    expect(names(fixture)).toEqual(['first.txt=first.txt', 'second.txt=second.txt']);
    expect(one(fixture, 'p').getAttribute('data-nxa-attachment-source')).toBe('edit-composer');

    click(all(fixture, 'button')[0]!);
    await waitFor(() => message.composer.getState().attachments.length === 1);
    await settle(fixture);

    expect(names(fixture)).toEqual(['second.txt=second.txt']);
    expect(message.getState().attachments).toHaveLength(2);
  });
});

describe('nxaAttachmentRemove', () => {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NxaComposerAttachments, NxaAttachmentRemove],
    providers: [provideLocalRuntime(model, { adapters: { attachments: attachmentAdapter() } })],
    template: `
      <div *nxaComposerAttachments>
        <button nxaAttachmentRemove [disabled]="disabled()">Remove</button>
      </div>
    `,
  })
  class Host {
    readonly composer = injectComposer();
    readonly disabled = signal(false);
  }

  it('can be vetoed by a capture-phase listener and disabled by its input', async () => {
    const fixture = render(Host);
    const { composer } = fixture.componentInstance;
    await composer.addAttachment(file('first.txt'));
    await settle(fixture);
    const button = one(fixture, 'button') as HTMLButtonElement;
    expect(button.type).toBe('button');

    veto(fixture.nativeElement, 'click');
    click(button);
    await flush();
    expect(draftNames(composer)).toEqual(['first.txt']);

    fixture.componentInstance.disabled.set(true);
    await settle(fixture);
    expect(button.disabled).toBe(true);
  });

  it('reports a removal that fails instead of leaving it unhandled', async () => {
    const fixture = render(Host);
    const { composer } = fixture.componentInstance;
    await composer.addAttachment(file('first.txt'));
    await settle(fixture);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // The attachment goes before the row does: a click in between finds nothing to remove.
    await composer.getAttachmentByIndex(0).remove();
    click(one(fixture, 'button'));
    await flush();

    expect(errorSpy).toHaveBeenCalledWith(
      '[ngx-assistant] Removing the attachment failed',
      expect.any(Error),
    );
  });
});

describe('nxaAttachmentRemove with a runtime that throws', () => {
  it('reports a removal that throws before returning a promise', async () => {
    const runtime = {
      getState: () => ({ ...completeAttachment('own'), source: 'thread-composer' as const }),
      subscribe: () => () => undefined,
      remove: () => {
        throw new Error('Composer is not available');
      },
    } as unknown as AttachmentRuntime;

    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaAttachmentRemove],
      providers: [provideAttachmentScope(() => runtime)],
      template: `<button nxaAttachmentRemove>Remove</button>`,
    })
    class Host {}

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = render(Host);
    click(one(fixture, 'button'));
    await flush();

    expect(errorSpy).toHaveBeenCalledWith(
      '[ngx-assistant] Removing the attachment failed',
      expect.objectContaining({ message: 'Composer is not available' }),
    );
  });
});

describe('nxaAttachmentThumb', () => {
  const label = (name: string, type = 'file') => getAttachmentLabel({ name, type });

  it('gives the dotted extension for a single-extension name', () => {
    expect(label('photo.png')).toBe('.png');
  });

  it('takes only the last segment for a multi-extension name', () => {
    expect(label('archive.tar.gz')).toBe('.gz');
  });

  it('falls back to the attachment type when the name has no extension', () => {
    expect(label('noext', 'document')).toBe('document');
  });

  it('falls back to the attachment type for an empty name', () => {
    expect(label('', 'image')).toBe('image');
  });

  it('treats a leading-dot name as extensionless', () => {
    expect(label('.gitignore')).toBe('file');
  });

  it('falls back to the attachment type for a trailing-dot name', () => {
    expect(label('report.', 'image')).toBe('image');
  });

  it('exposes the label of the nearest attachment', async () => {
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaComposerAttachments, NxaAttachmentThumb],
      providers: [provideLocalRuntime(model, { adapters: { attachments: attachmentAdapter() } })],
      template: `
        <span *nxaComposerAttachments nxaAttachmentThumb #thumb="nxaAttachmentThumb">{{
          thumb.label()
        }}</span>
      `,
    })
    class Host {
      readonly composer = injectComposer();
    }

    const fixture = render(Host);
    await fixture.componentInstance.composer.addAttachment(file('notes.md'));
    await fixture.componentInstance.composer.addAttachment(file('README'));
    await settle(fixture);

    expect(all(fixture, 'span').map((span) => span.textContent?.trim())).toEqual([
      '.md',
      'document',
    ]);
  });
});

describe('nxaComposerAddAttachment', () => {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NxaComposerAddAttachment],
    providers: [provideLocalRuntime(model, { adapters: { attachments: attachmentAdapter() } })],
    template: `
      @if (shown()) {
        <button nxaComposerAddAttachment [multiple]="multiple()" [disabled]="disabled()">
          Add file
        </button>
      }
    `,
  })
  class Host {
    readonly composer = injectComposer();
    readonly assistant = injectAssistant();
    readonly multiple = signal(true);
    readonly disabled = signal(false);
    readonly shown = signal(true);
  }

  const picker = () => document.querySelector<HTMLInputElement>('input[type="file"]');

  /** Chooses `files` in the open picker and waits for the attachments it starts. */
  const choose = async (input: HTMLInputElement, files: File[]) => {
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    await input.onchange?.call(input, new Event('change'));
  };

  async function open() {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const fixture = render(Host);
    await settle(fixture);
    click(one(fixture, 'button'));
    const input = picker()!;
    expect(input).not.toBeNull();
    return { fixture, input, composer: fixture.componentInstance.composer };
  }

  it('opens a hidden picker that accepts what the composer accepts', async () => {
    const { input } = await open();

    expect(input.hidden).toBe(true);
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('text/plain,image/*');
    expect(input.parentElement).toBe(document.body);
  });

  it('opens a single-file picker when multiple is false', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const fixture = render(Host);
    fixture.componentInstance.multiple.set(false);
    await settle(fixture);
    click(one(fixture, 'button'));

    expect(picker()!.multiple).toBe(false);
  });

  it('adds the chosen files to the thread that opened the picker', async () => {
    const { input, composer } = await open();
    await choose(input, [file('thread-a.txt')]);

    expect(draftNames(composer)).toEqual(['thread-a.txt']);
    expect(input.isConnected).toBe(false);
  });

  it('keeps going after a rejected file, without logging it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { input, composer } = await open();
    await choose(input, [file('broken.bin'), file('supported.txt')]);

    expect(draftNames(composer)).toEqual(['supported.txt']);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(input.isConnected).toBe(false);
  });

  it('does not add an old picker selection to a different thread', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const store = createStore();
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaComposerAddAttachment],
      providers: [store.provider],
      template: `<button nxaComposerAddAttachment>Add file</button>`,
    })
    class StoreHost {
      readonly composer = injectComposer();
    }
    const fixture = render(StoreHost);
    const { composer } = fixture.componentInstance;
    await settle(fixture);
    click(one(fixture, 'button'));
    const input = picker()!;

    store.threadId.set('thread-b');
    await settle(fixture);
    await choose(input, [file('thread-a.txt')]);

    expect(composer.getState().attachments).toHaveLength(0);
    expect(input.isConnected).toBe(false);

    // A picker opened in the new thread adds to it.
    click(one(fixture, 'button'));
    await choose(picker()!, [file('thread-b.txt')]);
    expect(draftNames(composer)).toEqual(['thread-b.txt']);
  });

  it('does not add an old picker selection after switching away and back', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const store = createStore();
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaComposerAddAttachment],
      providers: [store.provider],
      template: `<button nxaComposerAddAttachment>Add file</button>`,
    })
    class StoreHost {
      readonly composer = injectComposer();
    }
    const fixture = render(StoreHost);
    const { composer } = fixture.componentInstance;
    await settle(fixture);
    click(one(fixture, 'button'));
    const input = picker()!;

    store.threadId.set('thread-b');
    await settle(fixture);
    store.threadId.set('thread-a');
    await settle(fixture);
    await choose(input, [file('late.txt')]);

    expect(composer.getState().attachments).toHaveLength(0);
  });

  it('does not add a selection once the button is disabled', async () => {
    const { input, composer, fixture } = await open();
    fixture.componentInstance.disabled.set(true);
    await settle(fixture);
    await choose(input, [file('late.txt')]);

    expect(composer.getState().attachments).toHaveLength(0);
  });

  it('keeps the picker usable when the same draft changes', async () => {
    const { input, composer } = await open();
    composer.setText('same conversation');
    await choose(input, [file('thread-a.txt')]);

    expect(composer.getState().text).toBe('same conversation');
    expect(draftNames(composer)).toEqual(['thread-a.txt']);
  });

  it('settles a picker result after the button is destroyed', async () => {
    const { input, composer, fixture } = await open();
    fixture.componentInstance.shown.set(false);
    await settle(fixture);
    expect(picker()).toBeNull();

    await expect(choose(input, [file('late.txt')])).resolves.toBeUndefined();
    expect(composer.getState().attachments).toHaveLength(0);
  });

  it('removes the picker when the choice is cancelled', async () => {
    const { input } = await open();
    input.dispatchEvent(new Event('cancel'));

    expect(picker()).toBeNull();
  });

  it('can be vetoed by a capture-phase listener', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const fixture = render(Host);
    await settle(fixture);
    veto(fixture.nativeElement, 'click');
    click(one(fixture, 'button'));

    expect(picker()).toBeNull();
  });

  it('is disabled by its input, a disabled thread or a composer that is not editing', async () => {
    const fixture = render(Host);
    await settle(fixture);
    const button = one(fixture, 'button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.type).toBe('button');

    fixture.componentInstance.disabled.set(true);
    await settle(fixture);
    expect(button.disabled).toBe(true);
    click(button);
    expect(picker()).toBeNull();

    const store = createStore([user('u1')]);
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaMessages, NxaComposerAddAttachment],
      providers: [store.provider],
      template: `
        <button nxaComposerAddAttachment id="thread">Add</button>
        <section *nxaMessages><button nxaComposerAddAttachment id="edit">Add</button></section>
      `,
    })
    class StoreHost {
      readonly thread = injectThread();
    }
    const storeFixture = render(StoreHost);
    await settle(storeFixture);
    const thread = one(storeFixture, '#thread') as HTMLButtonElement;
    const edit = one(storeFixture, '#edit') as HTMLButtonElement;
    expect(thread.disabled).toBe(false);
    expect(edit.disabled).toBe(true);

    storeFixture.componentInstance.thread.getMessageByIndex(0).composer.beginEdit();
    await settle(storeFixture);
    expect(edit.disabled).toBe(false);

    store.isDisabled.set(true);
    await settle(storeFixture);
    expect(thread.disabled).toBe(true);
    expect(edit.disabled).toBe(true);
  });
});

describe('nxaComposerAttachmentDropzone', () => {
  const dragEvent = (type: string, types: string[] = ['Files'], files: File[] = []) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { files, types, dropEffect: 'copy' },
      configurable: true,
    });
    return event as DragEvent;
  };

  const withRelated = (event: DragEvent, relatedTarget: Node | null) => {
    Object.defineProperty(event, 'relatedTarget', { value: relatedTarget });
    return event;
  };

  function setup(options: { attachments?: boolean } = {}) {
    const store = signal({ isDisabled: false });
    const addAttachment = vi.fn<(file: File | CreateAttachment) => Promise<void>>(
      async () => undefined,
    );
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaComposerAttachmentDropzone],
      providers: [
        provideExternalStoreRuntime<ThreadMessageLike>(() =>
          computed((): ExternalStoreAdapter<ThreadMessageLike> => ({
            messages: [],
            isDisabled: store().isDisabled,
            convertMessage: (message) => message,
            onNew: async () => undefined,
            ...(options.attachments === false
              ? {}
              : { adapters: { attachments: attachmentAdapter() } }),
          })),
        ),
      ],
      template: `
        <div nxaComposerAttachmentDropzone [disabled]="disabled()" id="zone">
          <span id="child">drop here</span>
        </div>
      `,
    })
    class Host {
      readonly disabled = signal(false);
      constructor() {
        vi.spyOn(injectComposer(), 'addAttachment').mockImplementation(addAttachment);
      }
    }
    const fixture = render(Host);
    const zone = one(fixture, '#zone');
    const child = one(fixture, '#child');
    const dispatch = async (target: Element, event: DragEvent) => {
      target.dispatchEvent(event);
      await settle(fixture);
      return event;
    };
    const setThreadDisabled = (isDisabled: boolean) => store.set({ isDisabled });
    return { fixture, zone, child, dispatch, addAttachment, setThreadDisabled };
  }

  const dragging = (zone: Element) => zone.hasAttribute('data-nxa-dragging');

  it('starts all dropped attachments before awaiting completion', async () => {
    const { zone, addAttachment, fixture } = setup();
    await settle(fixture);
    const resolvers: (() => void)[] = [];
    addAttachment.mockImplementation(() => new Promise<void>((resolve) => resolvers.push(resolve)));

    zone.dispatchEvent(
      dragEvent('drop', ['Files'], [file('first.txt'), file('second.txt'), file('third.txt')]),
    );

    expect(addAttachment.mock.calls.map(([dropped]) => (dropped as File).name)).toEqual([
      'first.txt',
      'second.txt',
      'third.txt',
    ]);
    for (const resolve of resolvers) resolve();
    await flush();
  });

  it('continues with the other files when one fails, without logging it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { zone, addAttachment, fixture } = setup();
    await settle(fixture);
    addAttachment.mockRejectedValueOnce(new Error('upload failed'));

    zone.dispatchEvent(dragEvent('drop', ['Files'], [file('a.txt'), file('b.txt'), file('c.txt')]));
    await flush();

    expect(addAttachment).toHaveBeenCalledTimes(3);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('highlights on file drags until the drag leaves the dropzone', async () => {
    const { zone, child, dispatch, fixture } = setup();
    await settle(fixture);

    const enter = await dispatch(zone, dragEvent('dragenter'));
    expect(enter.defaultPrevented).toBe(true);
    expect(dragging(zone)).toBe(true);

    await dispatch(zone, withRelated(dragEvent('dragleave'), child));
    expect(dragging(zone)).toBe(true);

    await dispatch(zone, withRelated(dragEvent('dragleave'), document.body));
    expect(dragging(zone)).toBe(false);

    const over = await dispatch(zone, dragEvent('dragover'));
    expect(over.defaultPrevented).toBe(true);
    expect(dragging(zone)).toBe(true);
  });

  it('clears the highlight when disabled during a drag, and keeps it off after re-enabling', async () => {
    const { zone, dispatch, fixture } = setup();
    await settle(fixture);
    await dispatch(zone, dragEvent('dragenter'));
    expect(dragging(zone)).toBe(true);

    fixture.componentInstance.disabled.set(true);
    await settle(fixture);
    expect(dragging(zone)).toBe(false);

    fixture.componentInstance.disabled.set(false);
    await settle(fixture);
    expect(dragging(zone)).toBe(false);
  });

  it('clears the highlight when the thread is disabled during a drag', async () => {
    const { zone, dispatch, setThreadDisabled, fixture } = setup();
    await settle(fixture);
    await dispatch(zone, dragEvent('dragenter'));
    expect(dragging(zone)).toBe(true);

    setThreadDisabled(true);
    await settle(fixture);
    expect(dragging(zone)).toBe(false);

    setThreadDisabled(false);
    await settle(fixture);
    expect(dragging(zone)).toBe(false);
  });

  it('claims a disabled file drop so it does not open the file, without adding it', async () => {
    const { zone, dispatch, addAttachment, fixture } = setup();
    fixture.componentInstance.disabled.set(true);
    await settle(fixture);

    const over = await dispatch(zone, dragEvent('dragover'));
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer!.dropEffect).toBe('none');
    expect(dragging(zone)).toBe(false);
    const drop = await dispatch(zone, dragEvent('drop', ['Files'], [file('a.txt')]));
    expect(drop.defaultPrevented).toBe(true);
    expect(addAttachment).not.toHaveBeenCalled();
  });

  it('blocks file drops while the thread is disabled', async () => {
    const { zone, dispatch, addAttachment, setThreadDisabled, fixture } = setup();
    setThreadDisabled(true);
    await settle(fixture);

    const enter = await dispatch(zone, dragEvent('dragenter'));
    expect(enter.defaultPrevented).toBe(true);
    expect(dragging(zone)).toBe(false);
    const drop = await dispatch(zone, dragEvent('drop', ['Files'], [file('a.txt')]));
    expect(drop.defaultPrevented).toBe(true);
    expect(addAttachment).not.toHaveBeenCalled();
  });

  it('ignores drags that carry no files', async () => {
    const { zone, dispatch, fixture } = setup();
    await settle(fixture);

    const enter = await dispatch(zone, dragEvent('dragenter', ['text/plain']));
    expect(enter.defaultPrevented).toBe(false);
    expect(dragging(zone)).toBe(false);
  });

  it('claims file drags without highlighting when the runtime has no attachments', async () => {
    const { zone, dispatch, addAttachment, fixture } = setup({ attachments: false });
    await settle(fixture);

    const enter = await dispatch(zone, dragEvent('dragenter'));
    expect(enter.defaultPrevented).toBe(true);
    expect(enter.dataTransfer!.dropEffect).toBe('none');
    expect(dragging(zone)).toBe(false);
    const drop = await dispatch(zone, dragEvent('drop', ['Files'], [file('a.txt')]));
    expect(drop.defaultPrevented).toBe(true);
    expect(addAttachment).not.toHaveBeenCalled();
  });

  it('clears the highlight and claims a file drop that yields no files', async () => {
    const { zone, dispatch, addAttachment, fixture } = setup();
    await settle(fixture);
    await dispatch(zone, dragEvent('dragenter'));

    const drop = await dispatch(zone, dragEvent('drop', ['Files'], []));
    expect(drop.defaultPrevented).toBe(true);
    expect(dragging(zone)).toBe(false);
    expect(addAttachment).not.toHaveBeenCalled();
  });

  it('lets drops that carry no files pass through', async () => {
    const { zone, dispatch, fixture } = setup();
    await settle(fixture);

    const drop = await dispatch(zone, dragEvent('drop', ['text/plain']));
    expect(drop.defaultPrevented).toBe(false);
  });

  it('sees a drop on a descendant that stops its propagation', async () => {
    const { child, addAttachment, fixture } = setup();
    await settle(fixture);
    child.addEventListener('drop', (event) => event.stopPropagation());

    child.dispatchEvent(dragEvent('drop', ['Files'], [file('a.txt')]));

    expect(addAttachment).toHaveBeenCalledTimes(1);
  });

  it('stops listening when destroyed', async () => {
    const { zone, addAttachment, fixture } = setup();
    await settle(fixture);
    fixture.destroy();

    const drop = dragEvent('drop', ['Files'], [file('a.txt')]);
    zone.dispatchEvent(drop);

    expect(drop.defaultPrevented).toBe(false);
    expect(addAttachment).not.toHaveBeenCalled();
  });
});
