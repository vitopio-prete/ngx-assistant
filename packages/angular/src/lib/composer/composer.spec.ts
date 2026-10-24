import { ChangeDetectionStrategy, Component, Provider, Type, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  createMessageQueue,
  type AssistantRuntime,
  type AttachmentAdapter,
  type ChatModelAdapter,
  type ThreadMessage,
} from '@ngx-assistant/engine';
import { provideExternalStoreRuntime } from '../external-store-runtime';
import { provideLocalRuntime, type LocalRuntimeOptions } from '../local-runtime';
import {
  injectAssistant,
  injectComposer,
  injectMessage,
  injectThread,
  NXA_THREAD,
  provideAssistantScope,
  provideMessageScope,
} from '../scopes';
import { NxaComposerCancel } from './composer-cancel';
import { NxaComposerInput, type NxaSubmitMode } from './composer-input';
import { NxaComposerRoot } from './composer-root';
import { NxaComposerSend } from './composer-send';

const replyModel = (): ChatModelAdapter => ({
  async *run() {
    yield { content: [{ type: 'text', text: 'reply' }] };
  },
});

/** A model that streams one chunk and then waits until the run is aborted. */
const blockingModel = (): ChatModelAdapter => ({
  async *run({ abortSignal }) {
    yield { content: [{ type: 'text', text: 'partial' }] };
    await new Promise((resolve) => abortSignal.addEventListener('abort', resolve));
  },
});

const attachments: AttachmentAdapter = {
  accept: '*',
  async add({ file }) {
    if (file.name.startsWith('broken')) throw new Error('upload failed');
    return {
      id: file.name,
      type: 'file',
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
};

const file = (name: string) => new File(['x'], name, { type: 'text/plain' });
const flush = () => new Promise<void>((resolve) => setTimeout(resolve));
const waitFor = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true));

const keydown = (target: Element, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

const enter = (target: Element, init: KeyboardEventInit = {}) =>
  keydown(target, { key: 'Enter', keyCode: 13, ...init });

const click = (target: Element, detail = 1) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail });
  target.dispatchEvent(event);
  return event;
};

const mousedown = (target: Element, button = 0) => {
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button });
  target.dispatchEvent(event);
  return event;
};

const paste = (target: Element, files: File[]) => {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files } });
  target.dispatchEvent(event);
  return event;
};

/** Vetoes `type` events below `root` with a capture-phase listener. */
const veto = (root: Element, type: string) =>
  root.addEventListener(type, (event) => event.preventDefault(), { capture: true });

const type = (textarea: HTMLTextAreaElement, value: string) => {
  textarea.value = value;
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
};

@Component({
  selector: 'nxa-test-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaComposerRoot, NxaComposerInput, NxaComposerSend, NxaComposerCancel],
  template: `
    <input aria-label="Outside" />
    <div data-nxa-thread-root>
      <button type="button" id="inside">Inside</button>
      <form nxaComposerRoot (submit)="record($event)" (mousedown)="touched = true">
        <textarea
          nxaComposerInput
          aria-label="Message"
          [submitMode]="submitMode()"
          [cancelOnEscape]="cancelOnEscape()"
          [addAttachmentOnPaste]="addAttachmentOnPaste()"
          [autoFocus]="autoFocus()"
          [focusOnRunStart]="focusOnRunStart()"
          [disabled]="inputDisabled()"
          (keydown)="touched = true"
          (paste)="touched = true"
        ></textarea>
        <span id="blank">blank space</span>
        <span id="widget" role="option" aria-selected="false" tabindex="-1">widget</span>
        <button nxaComposerSend [disabled]="sendDisabled()" (click)="touched = true">Send</button>
        <button nxaComposerCancel (click)="touched = true">Stop</button>
      </form>
      <div data-nxa-thread-root><button type="button" id="nested">Nested</button></div>
    </div>
  `,
})
class ComposerHost {
  readonly thread = injectThread();
  readonly composer = injectComposer();
  readonly submitMode = signal<NxaSubmitMode>('enter');
  readonly cancelOnEscape = signal(true);
  readonly addAttachmentOnPaste = signal(true);
  readonly autoFocus = signal(false);
  readonly focusOnRunStart = signal(true);
  readonly inputDisabled = signal(false);
  readonly sendDisabled = signal(false);
  readonly submits: Event[] = [];
  // Template listeners on the primitives' own elements, which run after them.
  touched = false;

  // Returns false, as Angular forms do on submit: Angular then prevents the default.
  record(event: Event) {
    this.submits.push(event);
    return false;
  }
}

@Component({
  selector: 'nxa-test-bare-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaComposerInput, NxaComposerSend],
  template: `
    <textarea nxaComposerInput aria-label="Message"></textarea>
    <button nxaComposerSend>Send</button>
  `,
})
class BareComposerHost {
  readonly composer = injectComposer();
}

@Component({
  selector: 'nxa-test-edit-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaComposerRoot, NxaComposerInput, NxaComposerCancel],
  providers: [provideMessageScope(() => injectThread().getMessageById('m0'))],
  template: `
    <form nxaComposerRoot>
      <textarea nxaComposerInput aria-label="Edit"></textarea>
      <button nxaComposerCancel (click)="onCancel($event)">Cancel edit</button>
    </form>
  `,
})
class EditRow {
  readonly message = injectMessage();
  readonly composer = injectComposer();
  onCancel: (event: Event) => void = () => undefined;
}

@Component({
  selector: 'nxa-test-edit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EditRow, NxaComposerRoot, NxaComposerInput],
  template: `
    <input aria-label="Outside" />
    <div data-nxa-thread-root>
      <nxa-test-edit-row />
      @if (showMain()) {
        <div nxaComposerRoot [attr.hidden]="mainHidden() ? '' : null">
          <textarea nxaComposerInput aria-label="Main" [disabled]="mainDisabled()"></textarea>
        </div>
      }
    </div>
  `,
})
class EditHost {
  readonly showMain = signal(true);
  readonly mainDisabled = signal(false);
  readonly mainHidden = signal(false);
}

@Component({
  selector: 'nxa-test-nested-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaComposerRoot],
  template: `<div nxaComposerRoot>
    <form><button>Inner</button></form>
  </div>`,
})
class NestedFormHost {
  readonly composer = injectComposer();
}

@Component({
  selector: 'nxa-test-nested-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaComposerRoot, NxaComposerInput, EditRow],
  template: `
    <div nxaComposerRoot>
      <span id="outer">blank space</span>
      <nxa-test-edit-row />
      <textarea nxaComposerInput aria-label="Main"></textarea>
    </div>
  `,
})
class NestedComposerHost {}

const withEditMessage: LocalRuntimeOptions = {
  initialMessages: [{ id: 'm0', role: 'user', content: 'original' }],
};

const render = async <T>(host: Type<T>, providers: Provider[]) => {
  TestBed.configureTestingModule({ providers });
  const fixture = TestBed.createComponent(host);
  await fixture.whenStable();
  return fixture;
};

const local = (model: ChatModelAdapter = replyModel(), options: LocalRuntimeOptions = {}) =>
  provideLocalRuntime(model, options);

const query = <E extends Element = HTMLElement>(
  fixture: ComponentFixture<unknown>,
  selector: string,
) => (fixture.nativeElement as HTMLElement).querySelector(selector) as E;

const parts = (fixture: ComponentFixture<unknown>) => ({
  textarea: query<HTMLTextAreaElement>(fixture, 'textarea'),
  send: query<HTMLButtonElement>(fixture, 'button[nxaComposerSend]'),
  cancel: query<HTMLButtonElement>(fixture, 'button[nxaComposerCancel]'),
  form: query<HTMLFormElement>(fixture, 'form'),
});

const injectedThread = (fixture: ComponentFixture<unknown>) =>
  fixture.debugElement.injector.get(NXA_THREAD)!;

const userMessages = (thread: { getState(): { messages: readonly { role: string }[] } }) =>
  thread.getState().messages.filter((m) => m.role === 'user').length;

describe('nxaComposerInput', () => {
  it('binds the draft both ways', async () => {
    const fixture = await render(ComposerHost, [local()]);
    const { composer } = fixture.componentInstance;
    const { textarea } = parts(fixture);

    type(textarea, 'draft');
    expect(composer.getState().text).toBe('draft');

    composer.setText('from the runtime');
    await fixture.whenStable();
    expect(textarea.value).toBe('from the runtime');
  });

  it('sends on Enter through the form, and an Enter that cannot send falls through', async () => {
    const fixture = await render(ComposerHost, [local()]);
    const { thread, composer, submits } = fixture.componentInstance;
    const { textarea } = parts(fixture);

    expect(enter(textarea).defaultPrevented).toBe(false);
    expect(submits).toHaveLength(0);

    composer.setText('hello');
    expect(enter(textarea).defaultPrevented).toBe(true);
    expect(submits).toHaveLength(1);
    expect(userMessages(thread)).toBe(1);
    expect(composer.getState().text).toBe('');
  });

  it('sends directly without a composer root', async () => {
    const fixture = await render(BareComposerHost, [local()]);
    const { composer } = fixture.componentInstance;
    const textarea = query<HTMLTextAreaElement>(fixture, 'textarea');
    const send = vi.spyOn(composer, 'send');

    composer.setText('hello');
    expect(enter(textarea).defaultPrevented).toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });

  it('inserts a newline on Shift+Enter', async () => {
    const fixture = await render(ComposerHost, [local()]);
    fixture.componentInstance.composer.setText('hello');

    expect(enter(parts(fixture).textarea, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(fixture.componentInstance.submits).toHaveLength(0);
  });

  it('ignores Enter while an IME composition is active', async () => {
    const fixture = await render(ComposerHost, [local()]);
    fixture.componentInstance.composer.setText('hello');

    expect(enter(parts(fixture).textarea, { isComposing: true }).defaultPrevented).toBe(false);
    expect(fixture.componentInstance.submits).toHaveLength(0);
  });

  it('ignores the Enter that commits a composition after compositionend (Safari)', async () => {
    const fixture = await render(ComposerHost, [local()]);
    const { composer, submits } = fixture.componentInstance;
    const { textarea } = parts(fixture);

    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    textarea.value = '日本語';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    textarea.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: '日本語' }),
    );
    expect(composer.getState().text).toBe('日本語');

    expect(enter(textarea, { keyCode: 229 }).defaultPrevented).toBe(false);
    expect(submits).toHaveLength(0);

    expect(enter(textarea).defaultPrevented).toBe(true);
    expect(submits).toHaveLength(1);
  });

  it("submitMode 'ctrlEnter' sends on Ctrl/Cmd+Enter only", async () => {
    const fixture = await render(ComposerHost, [local()]);
    const { composer, submits } = fixture.componentInstance;
    fixture.componentInstance.submitMode.set('ctrlEnter');
    await fixture.whenStable();
    const { textarea } = parts(fixture);

    composer.setText('one');
    expect(enter(textarea).defaultPrevented).toBe(false);
    expect(submits).toHaveLength(0);
    expect(enter(textarea, { metaKey: true }).defaultPrevented).toBe(true);
    expect(submits).toHaveLength(1);

    await waitFor(() => !fixture.componentInstance.thread.getState().isRunning);
    composer.setText('two');
    expect(enter(textarea, { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(submits).toHaveLength(2);
  });

  it("submitMode 'none' leaves Enter to the textarea", async () => {
    const fixture = await render(ComposerHost, [local()]);
    fixture.componentInstance.submitMode.set('none');
    await fixture.whenStable();
    fixture.componentInstance.composer.setText('hello');

    expect(enter(parts(fixture).textarea).defaultPrevented).toBe(false);
    expect(enter(parts(fixture).textarea, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(fixture.componentInstance.submits).toHaveLength(0);
  });

  it('lets Enter insert a newline during a run without a queue', async () => {
    const fixture = await render(ComposerHost, [local(blockingModel())]);
    const { thread, composer, submits } = fixture.componentInstance;
    void thread.append('first');
    await waitFor(() => thread.getState().isRunning);

    composer.setText('second');
    expect(enter(parts(fixture).textarea).defaultPrevented).toBe(false);
    expect(submits).toHaveLength(0);
    expect(userMessages(thread)).toBe(1);
    thread.cancelRun();
  });

  it('keeps the textarea on the composer text when the runtime rejects or resets a change', async () => {
    const fixture = await render(ComposerHost, [local()]);
    const { composer } = fixture.componentInstance;
    const { textarea } = parts(fixture);
    composer.setText('abc');
    await fixture.whenStable();

    type(textarea, 'abcd');
    composer.setText('abc');
    await fixture.whenStable();
    expect(textarea.value).toBe('abc');

    const setText = vi.spyOn(composer, 'setText').mockImplementation(() => undefined);
    type(textarea, 'rejected');
    expect(textarea.value).toBe('abc');
    setText.mockRestore();
  });

  it('sends on Enter during a run with a queue', async () => {
    const queue = createMessageQueue({ run: vi.fn() });
    const fixture = await render(ComposerHost, [
      provideExternalStoreRuntime<ThreadMessage>({
        messages: [],
        isRunning: true,
        onNew: async () => undefined,
        queue: queue.adapter,
      }),
    ]);
    const { composer, submits } = fixture.componentInstance;
    const send = vi.spyOn(composer, 'send');

    composer.setText('queued');
    expect(enter(parts(fixture).textarea).defaultPrevented).toBe(true);
    expect(submits).toHaveLength(1);
    expect(send).toHaveBeenCalledOnce();
  });

  it('steers on Ctrl/Cmd+Shift+Enter with a queue', async () => {
    const queue = createMessageQueue({ run: vi.fn() });
    const fixture = await render(ComposerHost, [
      provideExternalStoreRuntime<ThreadMessage>({
        messages: [],
        onNew: async () => undefined,
        queue: queue.adapter,
      }),
    ]);
    const { composer } = fixture.componentInstance;
    const send = vi.spyOn(composer, 'send');
    const { textarea } = parts(fixture);

    composer.setText('now');
    expect(enter(textarea, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(enter(textarea, { shiftKey: true, metaKey: true }).defaultPrevented).toBe(true);
    expect(send).toHaveBeenCalledExactlyOnceWith({ steer: true });

    fixture.componentInstance.submitMode.set('none');
    await fixture.whenStable();
    expect(enter(textarea, { shiftKey: true, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(send).toHaveBeenCalledOnce();
  });

  it('does not steer without a queue', async () => {
    const fixture = await render(ComposerHost, [local()]);
    const { composer } = fixture.componentInstance;
    const send = vi.spyOn(composer, 'send');

    composer.setText('now');
    expect(enter(parts(fixture).textarea, { shiftKey: true, metaKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('lets a capture keydown listener veto the send', async () => {
    const fixture = await render(ComposerHost, [local()]);
    const { composer, submits } = fixture.componentInstance;
    veto(parts(fixture).form, 'keydown');

    composer.setText('hello');
    enter(parts(fixture).textarea);
    expect(submits).toHaveLength(0);
    expect(composer.getState().text).toBe('hello');
  });

  it('is disabled while the thread is disabled, and sends nothing typed before', async () => {
    const fixture = await render(ComposerHost, [
      provideExternalStoreRuntime<ThreadMessage>({
        messages: [],
        isDisabled: true,
        onNew: async () => undefined,
      }),
    ]);
    const { composer, submits } = fixture.componentInstance;
    const { textarea, send } = parts(fixture);
    composer.setText('typed before');
    await fixture.whenStable();

    expect(textarea.disabled).toBe(true);
    expect(send.disabled).toBe(true);
    expect(enter(textarea).defaultPrevented).toBe(false);
    expect(submits).toHaveLength(0);
  });

  it('is disabled by its own disabled input', async () => {
    const fixture = await render(ComposerHost, [local()]);
    fixture.componentInstance.inputDisabled.set(true);
    await fixture.whenStable();
    fixture.componentInstance.composer.setText('hello');

    expect(parts(fixture).textarea.disabled).toBe(true);
    expect(enter(parts(fixture).textarea).defaultPrevented).toBe(false);
  });

  describe('Escape', () => {
    it('stops a run of the thread composer', async () => {
      const fixture = await render(ComposerHost, [local(blockingModel())]);
      const { thread } = fixture.componentInstance;
      void thread.append('first');
      await waitFor(() => thread.getState().isRunning);

      expect(keydown(parts(fixture).textarea, { key: 'Escape' }).defaultPrevented).toBe(true);
      await waitFor(() => !thread.getState().isRunning);
    });

    it('does nothing when there is nothing to cancel', async () => {
      const fixture = await render(ComposerHost, [local()]);
      expect(keydown(parts(fixture).textarea, { key: 'Escape' }).defaultPrevented).toBe(false);
    });

    it('ignores the Escape of an IME composition, Safari included', async () => {
      const fixture = await render(ComposerHost, [local(blockingModel())]);
      const { thread } = fixture.componentInstance;
      void thread.append('first');
      await waitFor(() => thread.getState().isRunning);
      const { textarea } = parts(fixture);

      expect(keydown(textarea, { key: 'Escape', isComposing: true }).defaultPrevented).toBe(false);
      expect(keydown(textarea, { key: 'Escape', keyCode: 229 }).defaultPrevented).toBe(false);
      await flush();
      expect(thread.getState().isRunning).toBe(true);
      thread.cancelRun();
    });

    it('can be turned off', async () => {
      const fixture = await render(ComposerHost, [local(blockingModel())]);
      const { thread } = fixture.componentInstance;
      fixture.componentInstance.cancelOnEscape.set(false);
      await fixture.whenStable();
      void thread.append('first');
      await waitFor(() => thread.getState().isRunning);

      expect(keydown(parts(fixture).textarea, { key: 'Escape' }).defaultPrevented).toBe(false);
      await flush();
      expect(thread.getState().isRunning).toBe(true);
      thread.cancelRun();
    });
  });

  describe('paste', () => {
    it('adds every pasted file, even after one fails, without reporting an error', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const fixture = await render(ComposerHost, [
        local(replyModel(), { adapters: { attachments } }),
      ]);
      const { composer } = fixture.componentInstance;

      const event = paste(parts(fixture).textarea, [
        file('broken.txt'),
        file('a.txt'),
        file('b.txt'),
      ]);
      expect(event.defaultPrevented).toBe(true);
      await waitFor(() => composer.getState().attachments.length === 2);
      expect(composer.getState().attachments.map((a) => a.name)).toEqual(['a.txt', 'b.txt']);
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    });

    it('leaves the paste alone when the thread takes no attachments', async () => {
      const fixture = await render(ComposerHost, [local()]);
      expect(paste(parts(fixture).textarea, [file('a.txt')]).defaultPrevented).toBe(false);
    });

    it('leaves the paste alone when addAttachmentOnPaste is false', async () => {
      const fixture = await render(ComposerHost, [
        local(replyModel(), { adapters: { attachments } }),
      ]);
      fixture.componentInstance.addAttachmentOnPaste.set(false);
      await fixture.whenStable();

      expect(paste(parts(fixture).textarea, [file('a.txt')]).defaultPrevented).toBe(false);
      await flush();
      expect(fixture.componentInstance.composer.getState().attachments).toHaveLength(0);
    });

    it('leaves a paste without files to the textarea', async () => {
      const fixture = await render(ComposerHost, [
        local(replyModel(), { adapters: { attachments } }),
      ]);
      expect(paste(parts(fixture).textarea, []).defaultPrevented).toBe(false);
    });
  });

  describe('focus', () => {
    it('takes the focus on appearing with autoFocus', async () => {
      const fixture = await render(ComposerHost, [local()]);
      const { textarea } = parts(fixture);
      expect(document.activeElement).not.toBe(textarea);

      fixture.componentInstance.autoFocus.set(true);
      await fixture.whenStable();
      expect(document.activeElement).toBe(textarea);
    });

    const runStart = async (focus: (fixture: ComponentFixture<ComposerHost>) => void) => {
      const fixture = await render(ComposerHost, [local()]);
      fixture.componentInstance.autoFocus.set(true);
      await fixture.whenStable();
      focus(fixture);
      await fixture.componentInstance.thread.append('programmatic');
      await flush();
      return fixture;
    };

    it('takes the focus at a run start when nothing is focused', async () => {
      const fixture = await runStart((f) => parts(f).textarea.blur());
      expect(document.activeElement).toBe(parts(fixture).textarea);
    });

    it.each([
      ['its send button', 'button[nxaComposerSend]'],
      ['another element of its thread', '#inside'],
    ])('takes the focus at a run start from %s', async (_, selector) => {
      const fixture = await runStart((f) => query(f, selector).focus());
      expect(document.activeElement).toBe(parts(fixture).textarea);
    });

    it.each([
      ['outside the thread', 'input'],
      ['in a nested thread', '#nested'],
    ])('keeps the focus %s at a run start', async (_, selector) => {
      const fixture = await runStart((f) => query(f, selector).focus());
      expect(document.activeElement).toBe(query(fixture, selector));
    });

    it('keeps the selection of a focused input at a run start', async () => {
      const fixture = await runStart((f) => {
        const { textarea } = parts(f);
        type(textarea, 'hello world');
        textarea.focus();
        textarea.setSelectionRange(2, 5);
      });
      const { textarea } = parts(fixture);
      expect(document.activeElement).toBe(textarea);
      expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 5]);
    });

    it('leaves the focus alone at a run start without autoFocus or with focusOnRunStart off', async () => {
      const fixture = await render(ComposerHost, [local()]);
      const inside = query(fixture, '#inside');
      inside.focus();
      await fixture.componentInstance.thread.append('one');
      await flush();
      expect(document.activeElement).toBe(inside);

      fixture.componentInstance.autoFocus.set(true);
      fixture.componentInstance.focusOnRunStart.set(false);
      await fixture.whenStable();
      inside.focus();
      await fixture.componentInstance.thread.append('two');
      await flush();
      expect(document.activeElement).toBe(inside);
    });

    it('takes the focus back when the thread list switches threads', async () => {
      let mainThreadId = 'a';
      const listeners = new Set<() => void>();
      const assistant = (real: AssistantRuntime) =>
        ({
          get thread() {
            return real.thread;
          },
          threads: {
            getState: () => ({ ...real.threads.getState(), mainThreadId }),
            subscribe: (callback: () => void) => {
              listeners.add(callback);
              return () => listeners.delete(callback);
            },
            unstable_subscribeThreadEvents: () => () => undefined,
          },
        }) as unknown as AssistantRuntime;
      TestBed.configureTestingModule({ providers: [local()] });
      const real = TestBed.runInInjectionContext(() => injectAssistant());

      @Component({
        selector: 'nxa-test-switch',
        changeDetection: ChangeDetectionStrategy.OnPush,
        imports: [NxaComposerInput],
        providers: [provideAssistantScope(() => assistant(real))],
        template: `
          <button type="button">Outside</button>
          <textarea nxaComposerInput aria-label="Message" autoFocus></textarea>
        `,
      })
      class SwitchHost {}

      const fixture = TestBed.createComponent(SwitchHost);
      await fixture.whenStable();
      const textarea = query<HTMLTextAreaElement>(fixture, 'textarea');
      expect(document.activeElement).toBe(textarea);

      query(fixture, 'button').focus();
      mainThreadId = 'b';
      for (const listener of listeners) listener();
      await flush();
      expect(document.activeElement).toBe(textarea);
    });
  });
});

describe('nxaComposerSend', () => {
  it('follows the draft and sends on click', async () => {
    const fixture = await render(ComposerHost, [local()]);
    const { thread, composer } = fixture.componentInstance;
    const { send } = parts(fixture);
    expect(send.type).toBe('button');
    expect(send.disabled).toBe(true);

    composer.setText('hello');
    await fixture.whenStable();
    expect(send.disabled).toBe(false);

    click(send);
    expect(userMessages(thread)).toBe(1);
    await fixture.whenStable();
    expect(send.disabled).toBe(true);
  });

  it('is disabled during a run without a queue', async () => {
    const fixture = await render(ComposerHost, [local(blockingModel())]);
    const { thread, composer } = fixture.componentInstance;
    void thread.append('first');
    await waitFor(() => thread.getState().isRunning);
    composer.setText('second');
    await fixture.whenStable();

    expect(parts(fixture).send.disabled).toBe(true);
    thread.cancelRun();
  });

  it('is not disabled during a run with a queue', async () => {
    const queue = createMessageQueue({ run: vi.fn() });
    const fixture = await render(ComposerHost, [
      provideExternalStoreRuntime<ThreadMessage>({
        messages: [],
        isRunning: true,
        onNew: async () => undefined,
        queue: queue.adapter,
      }),
    ]);
    fixture.componentInstance.composer.setText('queued');
    await fixture.whenStable();

    expect(parts(fixture).send.disabled).toBe(false);
  });

  it('lets a capture click listener veto the send', async () => {
    const fixture = await render(ComposerHost, [local()]);
    const { thread, composer } = fixture.componentInstance;
    veto(parts(fixture).form, 'click');
    composer.setText('hello');
    await fixture.whenStable();

    click(parts(fixture).send);
    expect(userMessages(thread)).toBe(0);
  });

  it('is disabled by its own disabled input', async () => {
    const fixture = await render(ComposerHost, [local()]);
    const { thread, composer } = fixture.componentInstance;
    fixture.componentInstance.sendDisabled.set(true);
    composer.setText('hello');
    await fixture.whenStable();

    expect(parts(fixture).send.disabled).toBe(true);
    click(parts(fixture).send);
    expect(userMessages(thread)).toBe(0);
  });
});

describe('nxaComposerCancel', () => {
  it('is enabled during a run and stops it', async () => {
    const fixture = await render(ComposerHost, [local(blockingModel())]);
    const { thread } = fixture.componentInstance;
    const { cancel } = parts(fixture);
    expect(cancel.type).toBe('button');
    expect(cancel.disabled).toBe(true);

    void thread.append('first');
    await waitFor(() => thread.getState().isRunning);
    await fixture.whenStable();
    expect(cancel.disabled).toBe(false);

    cancel.focus();
    click(cancel, 0);
    await waitFor(() => !thread.getState().isRunning);
    expect(document.activeElement).toBe(cancel);
  });

  it('calls onCancel of an external store', async () => {
    const onCancel = vi.fn(async () => undefined);
    const fixture = await render(ComposerHost, [
      provideExternalStoreRuntime<ThreadMessage>({
        messages: [],
        isRunning: true,
        onNew: async () => undefined,
        onCancel,
      }),
    ]);
    click(parts(fixture).cancel);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('lets a capture click listener veto the cancel', async () => {
    const fixture = await render(ComposerHost, [local(blockingModel())]);
    const { thread } = fixture.componentInstance;
    veto(parts(fixture).form, 'click');
    void thread.append('first');
    await waitFor(() => thread.getState().isRunning);
    await fixture.whenStable();

    click(parts(fixture).cancel);
    await flush();
    expect(thread.getState().isRunning).toBe(true);
    thread.cancelRun();
  });
});

describe('nxaComposerRoot', () => {
  it('marks the composer type', async () => {
    const fixture = await render(EditHost, [local(replyModel(), withEditMessage)]);
    const roots = (fixture.nativeElement as HTMLElement).querySelectorAll('[nxaComposerRoot]');
    expect([...roots].map((root) => root.getAttribute('data-nxa-composer-type'))).toEqual([
      'edit',
      'thread',
    ]);
  });

  it('sends on submit and ignores a submit that cannot send', async () => {
    const fixture = await render(ComposerHost, [local()]);
    const { thread, composer } = fixture.componentInstance;
    const { form } = parts(fixture);

    form.requestSubmit();
    expect(userMessages(thread)).toBe(0);

    composer.setText('hello');
    form.requestSubmit();
    expect(userMessages(thread)).toBe(1);
  });

  it('focuses the input on a primary mousedown on blank space', async () => {
    const fixture = await render(ComposerHost, [local()]);
    const blank = query(fixture, '#blank');

    expect(mousedown(blank).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(parts(fixture).textarea);
  });

  it('leaves interactive children, roving widgets and other buttons alone', async () => {
    const fixture = await render(ComposerHost, [local()]);
    for (const target of [parts(fixture).send, query(fixture, '#widget')]) {
      expect(mousedown(target).defaultPrevented).toBe(false);
      expect(document.activeElement).not.toBe(parts(fixture).textarea);
    }
    expect(mousedown(query(fixture, '#blank'), 2).defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(parts(fixture).textarea);
  });

  it('keeps the mousedown default when the input is disabled', async () => {
    const fixture = await render(ComposerHost, [local()]);
    fixture.componentInstance.inputDisabled.set(true);
    await fixture.whenStable();

    expect(mousedown(query(fixture, '#blank')).defaultPrevented).toBe(false);
  });

  it('lets a capture mousedown listener veto the focus', async () => {
    const fixture = await render(ComposerHost, [local()]);
    veto(parts(fixture).form, 'mousedown');

    mousedown(query(fixture, '#blank'));
    expect(document.activeElement).not.toBe(parts(fixture).textarea);
  });

  it('sends next to a submit listener that prevents the default, as Angular forms do', async () => {
    const fixture = await render(ComposerHost, [local()]);
    const { thread, composer, submits } = fixture.componentInstance;

    composer.setText('hello');
    expect(enter(parts(fixture).textarea).defaultPrevented).toBe(true);
    expect(submits).toHaveLength(1);
    expect(submits[0]!.defaultPrevented).toBe(true);
    expect(userMessages(thread)).toBe(1);
  });

  it('sends even when an earlier submit listener prevented the default', async () => {
    const fixture = await render(ComposerHost, [local()]);
    const { thread, composer } = fixture.componentInstance;
    veto(parts(fixture).form, 'submit');

    composer.setText('hello');
    parts(fixture).form.requestSubmit();
    expect(userMessages(thread)).toBe(1);
  });

  it('ignores a submit from a form nested in a non-form root', async () => {
    const fixture = await render(NestedFormHost, [local()]);
    const composer = fixture.componentInstance.composer;
    composer.setText('hello');

    const inner = query<HTMLFormElement>(fixture, 'form');
    inner.addEventListener('submit', (event) => event.preventDefault());
    inner.requestSubmit();
    expect(composer.getState().text).toBe('hello');
  });

  it('focuses its own input, not the input of a nested composer', async () => {
    const fixture = await render(NestedComposerHost, [local(replyModel(), withEditMessage)]);
    const outer = query(fixture, '#outer');
    mousedown(outer);
    expect(document.activeElement).toBe(query(fixture, 'textarea[aria-label="Main"]'));
  });
});

describe('edit composer', () => {
  const editing = async (
    options: { showMain?: boolean; mainDisabled?: boolean; mainHidden?: boolean } = {},
  ) => {
    const fixture = await render(EditHost, [local(replyModel(), withEditMessage)]);
    fixture.componentInstance.showMain.set(options.showMain ?? true);
    fixture.componentInstance.mainDisabled.set(options.mainDisabled ?? false);
    fixture.componentInstance.mainHidden.set(options.mainHidden ?? false);
    const row = fixture.debugElement.query((el) => el.name === 'nxa-test-edit-row')
      .componentInstance as EditRow;
    row.message.composer.beginEdit();
    await fixture.whenStable();
    const input = query<HTMLTextAreaElement>(fixture, 'textarea[aria-label="Edit"]');
    input.focus();
    return {
      fixture,
      row,
      input,
      cancel: query<HTMLButtonElement>(fixture, 'button[nxaComposerCancel]'),
      main: () => query<HTMLTextAreaElement>(fixture, 'textarea[aria-label="Main"]'),
    };
  };

  it('ignores typing before the edit begins', async () => {
    const fixture = await render(EditHost, [local(replyModel(), withEditMessage)]);
    const input = query<HTMLTextAreaElement>(fixture, 'textarea[aria-label="Edit"]');
    const row = fixture.debugElement.query((el) => el.name === 'nxa-test-edit-row')
      .componentInstance as EditRow;

    type(input, 'typed');
    expect(input.value).toBe('');
    expect(row.composer.getState().text).toBe('');

    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(row.composer.getState().isEditing).toBe(false);
  });

  it('ignores a paste and leaves cancel disabled before the edit begins', async () => {
    const fixture = await render(EditHost, [
      local(replyModel(), { ...withEditMessage, adapters: { attachments } }),
    ]);
    const input = query<HTMLTextAreaElement>(fixture, 'textarea[aria-label="Edit"]');

    expect(paste(input, [file('a.txt')]).defaultPrevented).toBe(false);
    expect(query<HTMLButtonElement>(fixture, 'button[nxaComposerCancel]').disabled).toBe(true);
    expect(keydown(input, { key: 'Escape' }).defaultPrevented).toBe(false);
  });

  it('edits the message text', async () => {
    const { fixture, input, row } = await editing();
    expect(input.value).toBe('original');

    type(input, 'edited');
    enter(input);
    await fixture.whenStable();
    expect(row.composer.getState().isEditing).toBe(false);
    const [first] = injectedThread(fixture).getState().messages;
    expect(first?.content).toEqual([{ type: 'text', text: 'edited' }]);
  });

  it.each(['Escape', 'keyboard click'])(
    'moves the focus to the main composer after %s',
    async (how) => {
      const { input, cancel, main, row } = await editing();
      if (how === 'Escape') {
        keydown(input, { key: 'Escape' });
      } else {
        cancel.focus();
        click(cancel, 0);
      }
      expect(row.composer.getState().isEditing).toBe(false);
      expect(document.activeElement).toBe(main());
    },
  );

  it('keeps the focus after a pointer click', async () => {
    const { cancel, main, row } = await editing();
    cancel.focus();
    click(cancel, 1);
    expect(row.composer.getState().isEditing).toBe(false);
    expect(document.activeElement).not.toBe(main());
  });

  it('keeps the focus a cancel handler moved', async () => {
    const { fixture, cancel, row } = await editing();
    const outside = query(fixture, 'input[aria-label="Outside"]');
    row.onCancel = () => outside.focus();
    cancel.focus();
    click(cancel, 0);
    expect(document.activeElement).toBe(outside);
  });

  it.each([{ showMain: false }, { mainDisabled: true }, { mainHidden: true }])(
    'cancels without a usable main composer: %j',
    async (options) => {
      const { input, row } = await editing(options);
      keydown(input, { key: 'Escape' });
      expect(row.composer.getState().isEditing).toBe(false);
      expect(document.activeElement).toBe(input);
    },
  );

  it('does not move the focus without a thread root', async () => {
    const { fixture, input, main } = await editing();
    const root = query(fixture, '[data-nxa-thread-root]');
    root.removeAttribute('data-nxa-thread-root');
    keydown(input, { key: 'Escape' });
    expect(document.activeElement).not.toBe(main());
  });
});
