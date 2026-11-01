import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  Injector,
  createEnvironmentInjector,
  inject,
  input,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  ChatModelAdapter,
  ThreadRuntime,
  SpeechSynthesisAdapter,
  ThreadMessageLike,
} from '@ngx-assistant/engine';
import { NxaActionBarCopy } from './actions/action-bar-copy';
import { NxaActionBarReload } from './actions/action-bar-reload';
import { NxaActionBarSpeak } from './actions/action-bar-speak';
import { NxaBranchPickerNext, NxaBranchPickerPrevious } from './actions/branch-picker';
import { injectNxaEvent, type NxaEventName } from './events';
import { provideLocalRuntime } from './local-runtime';
import { NxaMessageRoot } from './messages/message-root';
import { NxaMessages } from './messages/messages';
import { NXA_THREAD, injectMessage, injectThread } from './scopes';

const UI_EVENTS = [
  'message.copied',
  'message.speak',
  'message.reload',
  'message.branchSwitched',
] as const satisfies NxaEventName[];

const seeded: ThreadMessageLike[] = [
  { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hello' }] },
  {
    id: 'a1',
    role: 'assistant',
    content: [{ type: 'text', text: 'hi' }],
    status: { type: 'complete', reason: 'stop' },
  },
];

const model: ChatModelAdapter = {
  async *run() {
    yield { content: [{ type: 'text', text: 'again' }] };
  },
};

const speech: SpeechSynthesisAdapter = {
  speak: () => ({
    status: { type: 'running' },
    cancel: () => undefined,
    subscribe: () => () => undefined,
  }),
};

let log: string[] = [];
let copyFails = false;

/** Records the UI events of its message scope. */
@Component({ selector: 'nxa-test-probe', template: '' })
class Probe {
  constructor() {
    const message = injectMessage();
    for (const event of UI_EVENTS) {
      injectNxaEvent(event, ({ threadId, messageId }) =>
        log.push(`message(${message.getState().id}) ${event} ${threadId}/${messageId}`),
      );
    }
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaMessages,
    NxaMessageRoot,
    NxaActionBarCopy,
    NxaActionBarSpeak,
    NxaActionBarReload,
    NxaBranchPickerPrevious,
    NxaBranchPickerNext,
    Probe,
  ],
  template: `
    <article *nxaMessages="let message" nxaMessageRoot [attr.data-id]="message().id">
      <button nxaActionBarCopy class="copy" [copyToClipboard]="copy">Copy</button>
      <button nxaActionBarSpeak class="speak">Speak</button>
      <button nxaActionBarReload class="reload">Reload</button>
      <button nxaBranchPickerPrevious class="prev">‹</button>
      <button nxaBranchPickerNext class="next">›</button>
      @if (probes()) {
        <nxa-test-probe />
      }
    </article>
  `,
})
class Chat {
  readonly probes = input(true);
  readonly thread = injectThread();
  readonly injector = inject(Injector);
  protected readonly copy = (value: string) =>
    copyFails ? Promise.reject(new Error(value)) : undefined;

  constructor() {
    for (const event of UI_EVENTS) {
      injectNxaEvent({ scope: 'thread', event }, ({ messageId }) =>
        log.push(`thread ${event} ${messageId}`),
      );
      injectNxaEvent({ scope: '*', event }, ({ messageId }) => log.push(`* ${event} ${messageId}`));
    }
  }
}

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await fixture.whenStable();
}

async function mount() {
  TestBed.configureTestingModule({
    providers: provideLocalRuntime(model, { initialMessages: seeded, adapters: { speech } }),
  });
  const fixture = TestBed.createComponent(Chat);
  fixture.detectChanges();
  await settle(fixture);
  return fixture;
}

const button = (fixture: ComponentFixture<unknown>, id: string, selector: string) =>
  (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
    `article[data-id="${id}"] ${selector}`,
  )!;

const click = (target: Element) =>
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));

beforeEach(() => {
  copyFails = false;
  log = [];
});

describe('message UI events', () => {
  it('reports a copy to the message, its thread and the whole assistant', async () => {
    const fixture = await mount();
    const threadId = fixture.componentInstance.thread.getState().threadId;

    click(button(fixture, 'a1', '.copy'));
    await settle(fixture);

    expect(log).toEqual([
      'thread message.copied a1',
      '* message.copied a1',
      `message(a1) message.copied ${threadId}/a1`,
    ]);
  });

  it('reports speak and reload, and a branch switch from either button', async () => {
    const fixture = await mount();

    click(button(fixture, 'a1', '.speak'));
    await settle(fixture);
    expect(log.filter((line) => line.startsWith('message('))).toEqual([
      expect.stringMatching(/^message\(a1\) message\.speak .+\/a1$/),
    ]);

    log = [];
    click(button(fixture, 'a1', '.reload'));
    await vi.waitFor(async () => {
      await settle(fixture);
      expect(fixture.componentInstance.thread.getState().isRunning).toBe(false);
      expect(
        button(fixture, fixture.componentInstance.thread.getState().messages[1]!.id, '.prev')
          .disabled,
      ).toBe(false);
    });
    expect(log).toContain('thread message.reload a1');
    expect(log).toContain('* message.reload a1');
    expect(log).toContainEqual(expect.stringMatching(/^message\(a1\) message\.reload/));

    log = [];
    const reloaded = fixture.componentInstance.thread.getState().messages[1]!.id;
    click(button(fixture, reloaded, '.prev'));
    await settle(fixture);
    expect(log).toContain(`thread message.branchSwitched ${reloaded}`);
    expect(log).toContainEqual(
      expect.stringMatching(new RegExp(`^message\\(${reloaded}\\) message\\.branchSwitched`)),
    );

    log = [];
    click(button(fixture, 'a1', '.next'));
    await settle(fixture);
    expect(log).toContain('* message.branchSwitched a1');
  });

  it('is not reported for a failed copy or a disabled branch button', async () => {
    const fixture = await mount();
    copyFails = true;

    click(button(fixture, 'a1', '.copy'));
    click(button(fixture, 'a1', '.prev'));
    await settle(fixture);

    expect(button(fixture, 'a1', '.prev').disabled).toBe(true);
    expect(log).toEqual([]);
  });

  it('is not reported for a vetoed click or a runtime call', async () => {
    const fixture = await mount();
    (fixture.nativeElement as HTMLElement).addEventListener('click', (e) => e.preventDefault(), {
      capture: true,
    });

    click(button(fixture, 'a1', '.speak'));
    click(button(fixture, 'a1', '.copy'));
    fixture.componentInstance.thread.getMessageById('a1').speak();
    await settle(fixture);

    expect(log).toEqual([]);
  });

  it('stops delivering when the listening scope is destroyed', async () => {
    const fixture = await mount();
    fixture.componentRef.setInput('probes', false);
    await settle(fixture);

    click(button(fixture, 'a1', '.copy'));
    await settle(fixture);

    expect(log).toEqual(['thread message.copied a1', '* message.copied a1']);
  });

  it('keeps a nested assistant scope apart', async () => {
    const fixture = await mount();
    const nested = createEnvironmentInjector(
      provideLocalRuntime(model, { initialMessages: seeded }),
      TestBed.inject(EnvironmentInjector),
    );
    const heard: string[] = [];
    injectNxaEvent(
      { scope: '*', event: 'message.copied' },
      ({ messageId }) => heard.push(messageId),
      {
        injector: nested,
      },
    );

    click(button(fixture, 'a1', '.copy'));
    await settle(fixture);

    expect(heard).toEqual([]);
    expect(log).toContain('* message.copied a1');
    nested.destroy();
  });

  it('narrows the thread scope to the thread it shows', async () => {
    const fixture = await mount();
    const thread = fixture.componentInstance.thread;
    const other = createEnvironmentInjector(
      [
        {
          provide: NXA_THREAD,
          useValue: Object.assign(Object.create(thread) as ThreadRuntime, {
            getState: () => ({ ...thread.getState(), threadId: 'another-thread' }),
          }),
        },
      ],
      TestBed.inject(EnvironmentInjector),
    );
    const heard: string[] = [];
    injectNxaEvent(
      { scope: 'thread', event: 'message.copied' },
      ({ messageId }) => heard.push(messageId),
      { injector: other },
    );

    click(button(fixture, 'a1', '.copy'));
    await settle(fixture);

    expect(heard).toEqual([]);
    expect(log).toContain('thread message.copied a1');
    other.destroy();
  });

  it('needs a message scope to listen in one', async () => {
    const fixture = await mount();
    expect(() =>
      injectNxaEvent('message.copied', () => undefined, {
        injector: fixture.componentInstance.injector,
      }),
    ).toThrow(/No message scope/);
  });
});
