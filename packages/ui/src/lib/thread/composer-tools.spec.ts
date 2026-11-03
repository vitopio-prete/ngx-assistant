import { ChangeDetectionStrategy, Component, EnvironmentInjector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  injectAssistant,
  provideLocalRuntime,
  provideRemoteThreadListRuntime,
  type ModelOption,
} from '@ngx-assistant/angular';
import {
  SimpleTextAttachmentAdapter,
  type ChatModelAdapter,
  type ModelContext,
} from '@ngx-assistant/engine';
import { NxaAssistantModal } from '../assistant-modal/assistant-modal';
import { NxaModelSelector } from '../model-selector/model-selector';
import { stubResizeObserver } from '../../testing/thread-harness';
import { makeAdapter, slots, until, withTitles } from '../../testing/thread-list-harness';
import { NxaComposer } from './composer';
import { NxaThread } from './thread';

const MODELS: ModelOption[] = [
  { id: 'small', name: 'Small' },
  { id: 'large', name: 'Large' },
];

const contexts: ModelContext[] = [];
const model: ChatModelAdapter = {
  async *run({ context }) {
    contexts.push(context);
    yield { content: [{ type: 'text', text: 'ok' }] };
  },
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaThread, NxaModelSelector],
  providers: [
    provideLocalRuntime(model, { adapters: { attachments: new SimpleTextAttachmentAdapter() } }),
  ],
  template: `
    <nxa-thread [autoFocus]="false">
      <nxa-model-selector
        nxaComposerTools
        variant="ghost"
        side="top"
        [models]="models"
        [(value)]="value"
      />
    </nxa-thread>
  `,
})
class ThreadHost {
  readonly models = MODELS;
  readonly value = signal<string | undefined>(undefined);
  readonly assistant = injectAssistant();
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaComposer],
  providers: [provideLocalRuntime(model)],
  template: `<nxa-composer [autoFocus]="false" />`,
})
class BareComposerHost {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaAssistantModal, NxaModelSelector],
  template: `
    <nxa-assistant-modal>
      <nxa-model-selector nxaComposerTools side="top" [models]="models" [(value)]="value" />
    </nxa-assistant-modal>
  `,
})
class ModalHost {
  readonly models = MODELS;
  readonly value = signal<string | undefined>(undefined);
}

async function mount<T>(component: new () => T) {
  const fixture = TestBed.createComponent(component);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

beforeAll(stubResizeObserver);

afterEach(() => {
  contexts.length = 0;
  document.body.replaceChildren();
});

describe('the nxaComposerTools slot', () => {
  it('puts a model selector given to the thread in its composer, and its pick reaches the runs', async () => {
    const fixture = await mount(ThreadHost);
    const root = fixture.nativeElement as HTMLElement;
    const tools = slots(root, 'composer-tools')[0]!;
    const selector = tools.querySelector('[data-slot="model-selector"]');
    expect(selector).not.toBeNull();
    // After the attachment button.
    expect(tools.firstElementChild?.getAttribute('aria-label')).toBe('Add attachment');
    expect(tools.lastElementChild).toBe(selector);
    expect(slots(selector!, 'model-selector-content')[0]!.classList).toContain('bottom-full');

    const trigger = slots(root, 'model-selector-trigger')[0]!;
    trigger.click();
    await until(fixture, () => expect(trigger.getAttribute('aria-expanded')).toBe('true'));
    slots(root, 'model-selector-item')
      .find((node) => node.textContent?.includes('Large'))!
      .click();
    await until(fixture, () => expect(fixture.componentInstance.value()).toBe('large'));

    await fixture.componentInstance.assistant.thread.append('hi');
    await vi.waitFor(() => expect(contexts).toHaveLength(1));
    expect(contexts[0]!.config?.modelName).toBe('large');
  });

  it('keeps the focus in the open selector when its panel is pressed, not in the message field', async () => {
    const fixture = await mount(ThreadHost);
    const root = fixture.nativeElement as HTMLElement;
    const trigger = slots(root, 'model-selector-trigger')[0]!;
    trigger.focus();
    trigger.click();
    await until(fixture, () => expect(trigger.getAttribute('aria-expanded')).toBe('true'));

    // A tap: the mousedown that follows it must not reach the composer as a press on its padding.
    const panel = slots(root, 'model-selector-content')[0]!;
    panel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('leaves the composer as it was when nothing is given', async () => {
    const fixture = await mount(BareComposerHost);
    const tools = slots(fixture.nativeElement as HTMLElement, 'composer-tools')[0]!;
    expect(tools.querySelector('[data-slot="model-selector"]')).toBeNull();
    expect(tools.children).toHaveLength(0);
  });

  it('goes through the assistant modal to the composer of its thread', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRemoteThreadListRuntime({
          adapter: makeAdapter(withTitles()),
          runtime: () => provideLocalRuntime(model),
        }),
      ],
    });
    const fixture = await mount(ModalHost);
    document.body.querySelector<HTMLButtonElement>('[data-slot="assistant-modal-button"]')!.click();
    await until(fixture, () =>
      expect(document.body.querySelector('[data-slot="composer-tools"]')).not.toBeNull(),
    );
    const selector = () =>
      document.body.querySelector('[data-slot="composer-tools"] [data-slot="model-selector"]');
    const first = selector();
    expect(first).not.toBeNull();

    const trigger = slots(first!, 'model-selector-trigger')[0]!;
    trigger.click();
    await until(fixture, () => expect(trigger.getAttribute('aria-expanded')).toBe('true'));
    slots(first!, 'model-selector-item')
      .find((node) => node.textContent?.includes('Large'))!
      .click();
    await until(fixture, () => expect(fixture.componentInstance.value()).toBe('large'));

    // Closed and opened again, the window shows the same selector, and the pick still applies.
    const launcher = document.body.querySelector<HTMLButtonElement>(
      '[data-slot="assistant-modal-button"]',
    )!;
    launcher.click();
    await until(fixture, () => expect(selector()).toBeNull());
    const assistant = TestBed.inject(EnvironmentInjector).runInContext(() => injectAssistant());
    await assistant.thread.append('hi');
    await vi.waitFor(() => expect(contexts).toHaveLength(1));
    expect(contexts[0]!.config?.modelName).toBe('large');

    // The window opens by itself when the reply starts.
    await until(fixture, () => expect(selector()).toBe(first));
  });
});
