import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  ChatModelAdapter,
  ExternalStoreAdapter,
  MessageStatus,
  ThreadMessageLike,
} from '@ngx-assistant/engine';
import { provideExternalStoreRuntime } from '../external-store-runtime';
import { provideLocalRuntime } from '../local-runtime';
import { NxaMessages } from '../messages';
import { injectThread } from '../scopes';
import { NxaErrorRoot } from './error-root';
import { NxaMessageError, getMessageErrorText } from './message-error';

const waitFor = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true));

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await fixture.whenStable();
}

const errors = (fixture: ComponentFixture<unknown>) =>
  Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.error')).map(
    (element) => element.textContent?.trim(),
  );

const status = (value: MessageStatus) => ({ status: value });

describe('getMessageErrorText', () => {
  it('is undefined unless the message ended with an error', () => {
    expect(getMessageErrorText(status({ type: 'running' }))).toBeUndefined();
    expect(getMessageErrorText(status({ type: 'complete', reason: 'stop' }))).toBeUndefined();
    expect(
      getMessageErrorText(status({ type: 'incomplete', reason: 'cancelled' })),
    ).toBeUndefined();
    expect(getMessageErrorText({ status: undefined })).toBeUndefined();
  });

  it('gives a string error as is', () => {
    expect(
      getMessageErrorText(status({ type: 'incomplete', reason: 'error', error: 'rate limited' })),
    ).toBe('rate limited');
  });

  it('gives the message of an error object', () => {
    expect(
      getMessageErrorText(
        status({ type: 'incomplete', reason: 'error', error: { message: 'bad gateway' } }),
      ),
    ).toBe('bad gateway');
  });

  it('gives any other value as is', () => {
    const error = { code: 502, message: 42 };
    expect(getMessageErrorText(status({ type: 'incomplete', reason: 'error', error }))).toBe(error);
    expect(getMessageErrorText(status({ type: 'incomplete', reason: 'error', error: 0 }))).toBe(0);
    expect(getMessageErrorText(status({ type: 'incomplete', reason: 'error', error: false }))).toBe(
      false,
    );
  });

  it('falls back to a generic text when the error is missing', () => {
    expect(getMessageErrorText(status({ type: 'incomplete', reason: 'error' }))).toBe(
      'An error occurred',
    );
    expect(getMessageErrorText(status({ type: 'incomplete', reason: 'error', error: null }))).toBe(
      'An error occurred',
    );
  });
});

describe('nxaMessageError', () => {
  it('shows the error of a failed run, and hides it when the message runs again', async () => {
    const fail = signal(true);
    const model: ChatModelAdapter = {
      async *run() {
        if (fail()) throw new Error('model unavailable');
        yield { content: [{ type: 'text', text: 'reply' }] };
      },
    };

    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaMessages, NxaMessageError, NxaErrorRoot],
      providers: [provideLocalRuntime(model)],
      template: `
        <section *nxaMessages="let message" [attr.data-role]="message().role">
          <div class="error" *nxaMessageError="let error" nxaErrorRoot>{{ error() }}</div>
        </section>
      `,
    })
    class Host {
      readonly thread = injectThread();
    }

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const { thread } = fixture.componentInstance;
    thread.append('hello');
    await waitFor(() => !thread.getState().isRunning && thread.getState().messages.length === 2);
    await settle(fixture);

    expect(errors(fixture)).toEqual(['model unavailable']);
    const alert = (fixture.nativeElement as HTMLElement).querySelector('.error')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.closest('section')!.dataset['role']).toBe('assistant');

    fail.set(false);
    thread.getMessageByIndex(1).reload();
    await waitFor(() => !thread.getState().isRunning);
    await settle(fixture);

    expect(errors(fixture)).toEqual([]);
  });

  it('keeps its view while the error changes, and shows a value that is not a string', async () => {
    const messages = signal<readonly ThreadMessageLike[]>([
      {
        id: 'a1',
        role: 'assistant',
        content: [],
        status: { type: 'incomplete', reason: 'error', error: 'first' },
      },
    ]);

    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaMessages, NxaMessageError],
      providers: [
        provideExternalStoreRuntime<ThreadMessageLike>(() =>
          computed((): ExternalStoreAdapter<ThreadMessageLike> => ({
            messages: messages(),
            convertMessage: (message) => message,
            onNew: async () => undefined,
          })),
        ),
      ],
      template: `
        <section *nxaMessages>
          <p class="error" *nxaMessageError="let error">{{ error() }}</p>
        </section>
      `,
    })
    class Host {}

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await settle(fixture);
    expect(errors(fixture)).toEqual(['first']);
    const view = (fixture.nativeElement as HTMLElement).querySelector('.error');

    messages.set([
      {
        id: 'a1',
        role: 'assistant',
        content: [],
        status: { type: 'incomplete', reason: 'error', error: 503 },
      },
    ]);
    await settle(fixture);
    expect(errors(fixture)).toEqual(['503']);
    expect((fixture.nativeElement as HTMLElement).querySelector('.error')).toBe(view);

    messages.set([
      {
        id: 'a1',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        status: { type: 'complete', reason: 'stop' },
      },
    ]);
    await settle(fixture);
    expect(errors(fixture)).toEqual([]);
  });
});

describe('nxaErrorRoot', () => {
  it('lets the element replace its role', () => {
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaErrorRoot],
      template: `<div nxaErrorRoot id="default"></div>
        <div nxaErrorRoot role="status" id="custom"></div>`,
    })
    class Host {}

    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('#default')!.getAttribute('role')).toBe('alert');
    expect(element.querySelector('#custom')!.getAttribute('role')).toBe('status');
  });
});
