import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  InjectionToken,
  Injector,
  Provider,
  createEnvironmentInjector,
  inject,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ChatModelAdapter } from '@ngx-assistant/engine';
import { fromRuntime } from './from-runtime';
import { provideLocalRuntime } from './local-runtime';
import {
  injectAssistant,
  injectAttachment,
  injectComposer,
  injectMessage,
  injectMessageUi,
  injectPart,
  injectSuggestion,
  injectThread,
  injectThreadList,
  injectThreadListItem,
  provideAttachmentScope,
  provideMessageScope,
  providePartScope,
  provideSuggestionScope,
  provideThreadListItemScope,
} from './scopes';

const MESSAGE_ID = new InjectionToken<string>('MESSAGE_ID');

const replyModel: ChatModelAdapter = {
  async *run() {
    yield { content: [{ type: 'text', text: 'reply' }] };
  },
};

const child = (parent: Injector, providers: Provider[] = []) =>
  createEnvironmentInjector(providers, parent as EnvironmentInjector);

const root = (providers: Provider[] = []) => child(TestBed.inject(EnvironmentInjector), providers);

const withRuntime = () =>
  root(
    provideLocalRuntime(replyModel, {
      initialMessages: [
        {
          id: 'm0',
          role: 'user',
          content: 'first',
          attachments: [
            {
              id: 'a0',
              type: 'document',
              name: 'notes.txt',
              contentType: 'text/plain',
              status: { type: 'complete' },
              content: [{ type: 'text', text: 'notes' }],
            },
          ],
        },
        { id: 'm1', role: 'assistant', content: 'second' },
      ],
    }),
  );

describe('scopes', () => {
  it('throws a descriptive error outside a runtime provider', () => {
    const injector = root();
    expect(() => injector.runInContext(() => injectThread())).toThrow(
      '[ngx-assistant] No thread scope here: provide a runtime with provideLocalRuntime(...) or provideExternalStoreRuntime(...) on an ancestor.',
    );
    expect(() => injector.runInContext(() => injectMessage())).toThrow(
      '[ngx-assistant] No message scope here',
    );
    injector.destroy();
  });

  it('resolves unavailable scopes to null with optional', () => {
    const outside = root();
    expect(outside.runInContext(() => injectAssistant({ optional: true }))).toBeNull();
    outside.destroy();

    const injector = withRuntime();
    injector.runInContext(() => {
      expect(injectMessage({ optional: true })).toBeNull();
      expect(injectPart({ optional: true })).toBeNull();
      expect(injectAttachment({ optional: true })).toBeNull();
    });
    injector.destroy();
  });

  it('extends the parent scopes from a message scope', () => {
    const parent = withRuntime();
    const thread = parent.runInContext(() => injectThread());
    const scope = child(
      parent,
      provideMessageScope(() => thread.getMessageById('m1')),
    );

    scope.runInContext(() => {
      expect(injectThread()).toBe(thread);
      expect(injectAssistant()).toBe(parent.runInContext(() => injectAssistant()));
      expect(injectMessage().getState().id).toBe('m1');
      expect(injectMessageUi().isHovering()).toBe(false);
      expect(injectMessageUi()).toBe(injectMessageUi());
    });
    expect(scope.runInContext(() => injectMessageUi())).not.toBe(
      child(
        parent,
        provideMessageScope(() => thread.getMessageById('m1')),
      ).runInContext(() => injectMessageUi()),
    );
    parent.destroy();
  });

  it('uses the edit composer inside a message scope', () => {
    const parent = withRuntime();
    const thread = parent.runInContext(() => injectThread());
    const scope = child(
      parent,
      provideMessageScope(() => thread.getMessageById('m0')),
    );

    scope.runInContext(() => {
      const message = injectMessage();
      expect(injectComposer()).toBe(message.composer);
      expect(injectComposer()).not.toBe(thread.composer);
      expect(injectThread().composer).toBe(thread.composer);
    });
    expect(parent.runInContext(() => injectComposer())).toBe(thread.composer);
    parent.destroy();
  });

  it('edits a message through the scoped composer', () => {
    const parent = withRuntime();
    const thread = parent.runInContext(() => injectThread());
    const scope = child(
      parent,
      provideMessageScope(() => thread.getMessageById('m0')),
    );
    const composer = scope.runInContext(() => injectMessage().composer);
    expect(scope.runInContext(() => injectComposer())).toBe(composer);
    const isEditing = fromRuntime(composer, (s) => s.isEditing, { injector: scope });
    const text = fromRuntime(composer, (s) => s.text, { injector: scope });

    expect(isEditing()).toBe(false);
    composer.beginEdit();
    expect(isEditing()).toBe(true);
    expect(text()).toBe('first');
    expect(thread.composer.getState().text).toBe('');

    composer.cancel();
    expect(isEditing()).toBe(false);
    parent.destroy();
  });

  it('provides a part scope under a message scope', () => {
    const parent = withRuntime();
    const thread = parent.runInContext(() => injectThread());
    const message = child(
      parent,
      provideMessageScope(() => thread.getMessageById('m1')),
    );
    const part = child(
      message,
      providePartScope(() => message.runInContext(() => injectMessage()).getMessagePartByIndex(0)),
    );

    part.runInContext(() => {
      expect(injectPart().getState()).toMatchObject({ type: 'text', text: 'second' });
      expect(injectMessage().getState().id).toBe('m1');
    });
    parent.destroy();
  });

  it('isolates a nested runtime provider from the outer scopes', () => {
    const outer = withRuntime();
    const outerThread = outer.runInContext(() => injectThread());
    const message = child(
      outer,
      provideMessageScope(() => outerThread.getMessageById('m0')),
    );
    const inner = child(message, provideLocalRuntime(replyModel));

    inner.runInContext(() => {
      expect(injectThread()).not.toBe(outerThread);
      expect(injectThread().getState().messages).toEqual([]);
      expect(injectComposer()).toBe(injectThread().composer);
      expect(injectMessage({ optional: true })).toBeNull();
      expect(injectMessageUi({ optional: true })).toBeNull();
    });
    expect(message.runInContext(() => injectMessage().getState().id)).toBe('m0');
    outer.destroy();
  });

  it('provides an attachment scope, cleared again by a part scope', () => {
    const parent = withRuntime();
    const thread = parent.runInContext(() => injectThread());
    const message = child(
      parent,
      provideMessageScope(() => thread.getMessageById('m0')),
    );
    const attachment = child(
      message,
      provideAttachmentScope(() =>
        message.runInContext(() => injectMessage()).getAttachmentByIndex(0),
      ),
    );
    expect(attachment.runInContext(() => injectAttachment().getState().name)).toBe('notes.txt');

    const part = child(
      attachment,
      providePartScope(() => thread.getMessageById('m0').getMessagePartByIndex(0)),
    );
    expect(part.runInContext(() => injectAttachment({ optional: true }))).toBeNull();
    parent.destroy();
  });

  it('provides the thread list, and thread list item and suggestion scopes that a nested runtime clears', () => {
    const parent = withRuntime();
    const threads = parent.runInContext(() => injectThreadList());
    expect(threads).toBe(parent.runInContext(() => injectAssistant().threads));
    expect(parent.runInContext(() => injectThreadListItem({ optional: true }))).toBeNull();
    expect(() => parent.runInContext(() => injectSuggestion())).toThrow(/No suggestion scope/);

    const suggestion = { title: 't', label: '', prompt: 'p' };
    const scoped = child(parent, [
      ...provideThreadListItemScope(() => threads.mainItem),
      ...provideSuggestionScope(() => ({
        getState: () => suggestion,
        subscribe: () => () => undefined,
      })),
    ]);
    expect(scoped.runInContext(() => injectThreadListItem().getState().isMain)).toBe(true);
    expect(scoped.runInContext(() => injectSuggestion().getState())).toBe(suggestion);

    const nested = child(scoped, provideLocalRuntime(replyModel));
    expect(nested.runInContext(() => injectThreadListItem({ optional: true }))).toBeNull();
    expect(nested.runInContext(() => injectSuggestion({ optional: true }))).toBeNull();
    expect(nested.runInContext(() => injectThreadList())).not.toBe(threads);
    parent.destroy();
  });

  it('provides scopes on element injectors', async () => {
    @Component({
      selector: 'nxa-test-message',
      changeDetection: ChangeDetectionStrategy.OnPush,
      providers: [provideMessageScope(() => injectThread().getMessageById(inject(MESSAGE_ID)))],
      template: `<span>{{ id() }}:{{ isEditing() }}</span>`,
    })
    class MessageRow {
      readonly id = fromRuntime(injectMessage(), (s) => s.id);
      readonly isEditing = fromRuntime(injectComposer(), (s) => s.isEditing);
    }

    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [MessageRow],
      providers: [
        provideLocalRuntime(replyModel, {
          initialMessages: [{ id: 'm0', role: 'user', content: 'hi' }],
        }),
      ],
      template: `<nxa-test-message />`,
    })
    class Host {}

    TestBed.configureTestingModule({ providers: [{ provide: MESSAGE_ID, useValue: 'm0' }] });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toBe('m0:false');
    fixture.destroy();
  });
});
