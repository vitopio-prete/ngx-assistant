import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  InjectionToken,
  Type,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { ExternalStoreAdapter, ThreadMessageLike } from '@ngx-assistant/engine';
import { provideExternalStoreRuntime } from '../external-store-runtime';
import { NxaMessageParts } from '../messages/message-parts';
import { NxaMessages } from '../messages/messages';
import { injectPart } from '../scopes';
import { injectToolCall } from './tool-call';
import { injectToolUiRegistry, provideToolUi } from './tool-ui-registry';

type Content = Exclude<ThreadMessageLike['content'], string>;

const toolCall = (toolName: string, extra: Record<string, unknown> = {}) => ({
  type: 'tool-call' as const,
  toolCallId: 'call-1',
  toolName,
  args: { city: 'sf' },
  ...extra,
});

const assistant = (content: Content, id = 'a1'): ThreadMessageLike => ({
  id,
  role: 'assistant',
  content,
  status: { type: 'complete', reason: 'stop' },
});

/** An external store whose messages are a signal, with spies for the tool call callbacks. */
function createStore(initial: readonly ThreadMessageLike[] = [], { record = true } = {}) {
  const messages = signal<readonly ThreadMessageLike[]>(initial);
  const callbacks = {
    onNew: vi.fn(async () => undefined),
    onAddToolResult: vi.fn(),
    onResumeToolCall: vi.fn(),
    onRespondToToolApproval: vi.fn(),
    unstable_onRecordToolInteraction: vi.fn(),
  };
  const withoutRecord = { ...callbacks, unstable_onRecordToolInteraction: undefined };
  const adapter = computed((): ExternalStoreAdapter<ThreadMessageLike> => ({
    messages: messages(),
    convertMessage: (message) => message,
    ...(record ? callbacks : withoutRecord),
  }));
  const provider = provideExternalStoreRuntime<ThreadMessageLike>(adapter);
  return { messages, adapter, provider, ...callbacks };
}

type Store = ReturnType<typeof createStore>;

async function settle(fixture: ComponentFixture<unknown>) {
  await fixture.whenStable();
  await fixture.whenStable();
}

function render<T>(component: Type<T>) {
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  return fixture;
}

const query = (fixture: ComponentFixture<unknown>, selector: string) =>
  (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector);

const lifecycle = { mounts: 0, destroys: 0 };

@Component({
  selector: 'nxa-test-weather',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="ui">{{ summary() }}</span>`,
})
class WeatherTool {
  readonly tool = injectToolCall<{ city: string }>();
  protected readonly summary = computed(() =>
    [
      this.tool.part().toolName,
      this.tool.args().city,
      this.tool.status().type,
      typeof this.tool.addResult,
      typeof this.tool.resume,
      typeof this.tool.respondToApproval,
    ].join(','),
  );

  constructor() {
    lifecycle.mounts++;
    inject(DestroyRef).onDestroy(() => lifecycle.destroys++);
  }
}

@Component({
  selector: 'nxa-test-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button class="add-result" (click)="tool.addResult('72F')">add</button>
    <button class="resume" (click)="tool.resume('continue')">resume</button>
    <button class="approve" (click)="tool.respondToApproval({ approved: true })">approve</button>
    <button class="record" (click)="record()">record</button>
  `,
})
class ActionsTool {
  static last: ActionsTool | undefined;
  readonly tool = injectToolCall();
  recorded?: Promise<void>;

  constructor() {
    ActionsTool.last = this;
  }

  record() {
    this.recorded = this.tool.unstable_recordInteraction({
      type: 'action',
      payload: { choice: 'retry' },
    });
    this.recorded.catch(() => undefined);
  }
}

@Component({
  selector: 'nxa-test-first',
  template: `<span class="first">first</span>`,
})
class First {}

@Component({
  selector: 'nxa-test-second',
  template: `<span class="second">second</span>`,
})
class Second {}

@Component({
  selector: 'nxa-test-fallback',
  template: `<i class="fallback">{{ tool.part().toolName }}</i>`,
})
class Fallback {
  readonly tool = injectToolCall();
}

const PARTS_TEMPLATE = `
  <div *nxaMessages>
    <ng-container *nxaMessageParts="let part">
      @if (part().type === 'tool-call') {
        <span class="slot">[slot]</span>
      } @else {
        <span class="other">{{ part().type }}</span>
      }
    </ng-container>
  </div>
`;

function partsHost(store: Store, providers: unknown[] = []) {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NxaMessages, NxaMessageParts],
    providers: [store.provider, ...(providers as never[])],
    template: PARTS_TEMPLATE,
  })
  class Host {
    readonly registry = injectToolUiRegistry();
  }
  return Host;
}

beforeEach(() => {
  lifecycle.mounts = 0;
  lifecycle.destroys = 0;
});

afterEach(() => vi.restoreAllMocks());

describe('tool UI registry in *nxaMessageParts', () => {
  it('renders a registered tool UI over the template, with the call and its actions', async () => {
    const store = createStore([assistant([toolCall('weather')])]);
    const fixture = render(
      partsHost(store, [provideToolUi({ toolName: 'weather', component: WeatherTool })]),
    );
    await settle(fixture);

    expect(query(fixture, 'span.ui')?.textContent).toBe(
      'weather,sf,complete,function,function,function',
    );
    expect(query(fixture, 'span.slot')).toBeNull();
  });

  it('routes addResult, resume, respondToApproval and recorded interactions to the adapter', async () => {
    const store = createStore([
      assistant([toolCall('weather', { approval: { id: 'approval-1' } })]),
    ]);
    const fixture = render(
      partsHost(store, [provideToolUi({ toolName: 'weather', component: ActionsTool })]),
    );
    await settle(fixture);

    query(fixture, 'button.add-result')!.click();
    expect(store.onAddToolResult).toHaveBeenCalledTimes(1);
    expect(store.onAddToolResult.mock.calls[0]![0]).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'weather',
      result: '72F',
    });

    query(fixture, 'button.resume')!.click();
    expect(store.onResumeToolCall).toHaveBeenCalledTimes(1);
    expect(store.onResumeToolCall.mock.calls[0]![0]).toMatchObject({
      toolCallId: 'call-1',
      payload: 'continue',
    });

    query(fixture, 'button.approve')!.click();
    await vi.waitFor(() => expect(store.onRespondToToolApproval).toHaveBeenCalledTimes(1));
    expect(store.onRespondToToolApproval.mock.calls[0]![0]).toMatchObject({
      approvalId: 'approval-1',
      approved: true,
    });

    store.unstable_onRecordToolInteraction.mockClear();
    query(fixture, 'button.record')!.click();
    await vi.waitFor(() => expect(store.unstable_onRecordToolInteraction).toHaveBeenCalledTimes(1));
    expect(store.unstable_onRecordToolInteraction.mock.calls[0]![0]).toMatchObject({
      toolCallId: 'call-1',
      interaction: { type: 'action', payload: { choice: 'retry' } },
    });
  });

  it('falls back to the template without a registration and swaps live on register and dispose', async () => {
    const store = createStore([assistant([toolCall('weather')])]);
    const fixture = render(partsHost(store));
    await settle(fixture);
    expect(query(fixture, 'span.slot')).not.toBeNull();

    const dispose = fixture.componentInstance.registry.register('weather', WeatherTool);
    await settle(fixture);
    expect(query(fixture, 'span.ui')).not.toBeNull();
    expect(query(fixture, 'span.slot')).toBeNull();

    dispose();
    await settle(fixture);
    expect(query(fixture, 'span.slot')).not.toBeNull();
    expect(query(fixture, 'span.ui')).toBeNull();
    expect(lifecycle).toEqual({ mounts: 1, destroys: 1 });

    // A second dispose of the same registration changes nothing.
    fixture.componentInstance.registry.register('weather', First);
    dispose();
    await settle(fixture);
    expect(query(fixture, 'span.first')).not.toBeNull();
  });

  it('rejects a recorded interaction on a runtime that does not record them', async () => {
    const store = createStore([assistant([toolCall('weather')])], { record: false });
    const fixture = render(
      partsHost(store, [provideToolUi({ toolName: 'weather', component: ActionsTool })]),
    );
    await settle(fixture);

    query(fixture, 'button.record')!.click();
    await expect(ActionsTool.last!.recorded).rejects.toThrow(/does not support recording/);
  });

  it('rejects an approval answer the runtime refuses up front', async () => {
    const store = createStore([assistant([toolCall('weather')])]);
    const fixture = render(
      partsHost(store, [provideToolUi({ toolName: 'weather', component: ActionsTool })]),
    );
    await settle(fixture);
    await expect(ActionsTool.last!.tool.respondToApproval({ approved: true })).rejects.toThrow(
      /no pending approval/,
    );
  });

  it('puts a runtime registration before the UI declared at its level', async () => {
    const store = createStore([assistant([toolCall('weather')])]);
    const fixture = render(
      partsHost(store, [provideToolUi({ toolName: 'weather', component: First })]),
    );
    await settle(fixture);
    expect(query(fixture, 'span.first')).not.toBeNull();

    const dispose = fixture.componentInstance.registry.register('weather', Second);
    await settle(fixture);
    expect(query(fixture, 'span.second')).not.toBeNull();
    expect(query(fixture, 'span.first')).toBeNull();

    dispose();
    await settle(fixture);
    expect(query(fixture, 'span.first')).not.toBeNull();
  });

  it('swaps between the fallback and a named UI live', async () => {
    const store = createStore([assistant([toolCall('weather')])]);
    const fixture = render(partsHost(store, [provideToolUi({ fallback: Fallback })]));
    await settle(fixture);
    expect(query(fixture, 'i.fallback')).not.toBeNull();

    const registry = fixture.componentInstance.registry;
    const dispose = registry.register('weather', First);
    await settle(fixture);
    expect(query(fixture, 'span.first')).not.toBeNull();
    expect(query(fixture, 'i.fallback')).toBeNull();

    dispose();
    const disposeFallback = registry.registerFallback(Second);
    await settle(fixture);
    expect(query(fixture, 'span.second')).not.toBeNull();
    disposeFallback();
    await settle(fixture);
    expect(query(fixture, 'i.fallback')).not.toBeNull();
  });

  it('creates the UI again for a new call id, and for a part that becomes a tool call', async () => {
    const store = createStore([assistant([{ type: 'text', text: 'hi' }])]);
    const fixture = render(
      partsHost(store, [provideToolUi({ toolName: 'weather', component: WeatherTool })]),
    );
    await settle(fixture);
    expect(query(fixture, 'span.other')).not.toBeNull();

    store.messages.set([assistant([toolCall('weather')])]);
    await settle(fixture);
    expect(query(fixture, 'span.ui')).not.toBeNull();
    expect(query(fixture, 'span.other')).toBeNull();
    expect(lifecycle).toEqual({ mounts: 1, destroys: 0 });

    store.messages.set([assistant([toolCall('weather', { toolCallId: 'call-2' })])]);
    await settle(fixture);
    expect(lifecycle).toEqual({ mounts: 2, destroys: 1 });
  });

  it('renders a UI for each of two calls that share an id', async () => {
    const store = createStore([
      assistant([toolCall('weather'), toolCall('weather', { args: { city: 'la' } })]),
    ]);
    const fixture = render(
      partsHost(store, [provideToolUi({ toolName: 'weather', component: WeatherTool })]),
    );
    await settle(fixture);
    const cities = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('span.ui'),
    ).map((el) => el.textContent?.split(',')[1]);
    expect(cities).toEqual(['sf', 'la']);
  });

  it('does not route registrations for other tool names', async () => {
    const store = createStore([assistant([toolCall('weather')])]);
    const fixture = render(
      partsHost(store, [provideToolUi({ toolName: 'search', component: WeatherTool })]),
    );
    await settle(fixture);

    expect(query(fixture, 'span.slot')).not.toBeNull();
    expect(query(fixture, 'span.ui')).toBeNull();
  });

  it('uses the first registration when a tool name is registered twice', async () => {
    const store = createStore([assistant([toolCall('weather')])]);
    const fixture = render(
      partsHost(store, [
        provideToolUi({ toolName: 'weather', component: First }),
        provideToolUi({ toolName: 'weather', component: Second }),
      ]),
    );
    await settle(fixture);
    expect(query(fixture, 'span.first')).not.toBeNull();
    expect(query(fixture, 'span.second')).toBeNull();
  });

  it('renders the next registration of a name once the first is removed', async () => {
    const store = createStore([assistant([toolCall('weather')])]);
    const fixture = render(partsHost(store));
    const registry = fixture.componentInstance.registry;
    const disposeFirst = registry.register('weather', First);
    registry.register('weather', Second);
    await settle(fixture);
    expect(query(fixture, 'span.first')).not.toBeNull();

    disposeFirst();
    await settle(fixture);
    expect(query(fixture, 'span.second')).not.toBeNull();
    expect(query(fixture, 'span.first')).toBeNull();
  });

  it.each(['toString', 'constructor', '__proto__'])(
    'falls back for a tool named %s that only Object.prototype has',
    async (toolName) => {
      const store = createStore([assistant([toolCall(toolName)])]);
      const fixture = render(
        partsHost(store, [provideToolUi({ toolName: 'other', component: First })]),
      );
      await settle(fixture);
      expect(query(fixture, 'span.slot')).not.toBeNull();
    },
  );

  it('renders a tool UI registered under an inherited name', async () => {
    const store = createStore([assistant([toolCall('toString')])]);
    const fixture = render(
      partsHost(store, [provideToolUi({ toolName: 'toString', component: First })]),
    );
    await settle(fixture);
    expect(query(fixture, 'span.first')).not.toBeNull();
  });

  it('renders the registered fallback for tools without a UI of their own', async () => {
    const store = createStore([
      assistant([
        toolCall('weather'),
        toolCall('search', { toolCallId: 'call-2' }),
        { type: 'text', text: 'done' },
      ]),
    ]);
    const fixture = render(
      partsHost(store, [
        provideToolUi({ fallback: Fallback }),
        provideToolUi({ toolName: 'weather', component: First }),
      ]),
    );
    await settle(fixture);

    expect(query(fixture, 'span.first')).not.toBeNull();
    expect(query(fixture, 'i.fallback')?.textContent).toBe('search');
    expect(query(fixture, 'span.other')?.textContent).toBe('text');
    expect(query(fixture, 'span.slot')).toBeNull();
  });

  it('keeps the tool UI with its call when the parts are reordered', async () => {
    const store = createStore([assistant([{ type: 'text', text: 'before' }, toolCall('weather')])]);
    const fixture = render(
      partsHost(store, [provideToolUi({ toolName: 'weather', component: WeatherTool })]),
    );
    await settle(fixture);
    const ui = query(fixture, 'nxa-test-weather');

    store.messages.set([assistant([toolCall('weather'), { type: 'text', text: 'after' }])]);
    await settle(fixture);

    expect(query(fixture, 'nxa-test-weather')).toBe(ui);
    expect(lifecycle).toEqual({ mounts: 1, destroys: 0 });
    const order = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('nxa-test-weather, span.other'),
    ).map((el) => el.tagName.toLowerCase());
    expect(order).toEqual(['nxa-test-weather', 'span']);
  });

  it('updates the tool UI in place as the call changes', async () => {
    const store = createStore([
      {
        id: 'a1',
        role: 'assistant',
        content: [toolCall('weather')],
        status: { type: 'running' },
      },
    ]);
    const fixture = render(
      partsHost(store, [provideToolUi({ toolName: 'weather', component: WeatherTool })]),
    );
    await settle(fixture);
    expect(query(fixture, 'span.ui')?.textContent).toContain('weather,sf,running');

    store.messages.set([
      assistant([toolCall('weather', { args: { city: 'la' }, result: 'sunny' })]),
    ]);
    await settle(fixture);
    expect(query(fixture, 'span.ui')?.textContent).toContain('weather,la,complete');
    expect(lifecycle).toEqual({ mounts: 1, destroys: 0 });
  });

  it('destroys the tool UI with its message', async () => {
    const store = createStore([assistant([toolCall('weather')])]);
    const fixture = render(
      partsHost(store, [provideToolUi({ toolName: 'weather', component: WeatherTool })]),
    );
    await settle(fixture);
    expect(lifecycle.mounts).toBe(1);

    store.messages.set([]);
    await settle(fixture);
    expect(query(fixture, 'span.ui')).toBeNull();
    expect(lifecycle).toEqual({ mounts: 1, destroys: 1 });
  });
});

const LEFT_STORE = new InjectionToken<Store>('LEFT_STORE');
const RIGHT_STORE = new InjectionToken<Store>('RIGHT_STORE');

@Component({
  selector: 'nxa-test-left',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaMessages, NxaMessageParts],
  providers: [provideExternalStoreRuntime(() => inject(LEFT_STORE).adapter)],
  template: PARTS_TEMPLATE,
})
class LeftPane {
  readonly registry = injectToolUiRegistry();
}

@Component({
  selector: 'nxa-test-right',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaMessages, NxaMessageParts],
  providers: [provideExternalStoreRuntime(() => inject(RIGHT_STORE).adapter)],
  template: PARTS_TEMPLATE,
})
class RightPane {}

function nestedHost(store: Store) {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [RightPane],
    providers: [store.provider],
    template: `<nxa-test-right />`,
  })
  class Host {
    readonly registry = injectToolUiRegistry();
  }
  return Host;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LeftPane, RightPane],
  template: `<nxa-test-left /><nxa-test-right />`,
})
class TwoAssistants {}

describe('tool UI registry levels', () => {
  @Component({
    selector: 'nxa-test-parts',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NxaMessages, NxaMessageParts],
    template: PARTS_TEMPLATE,
  })
  class Parts {}

  @Component({
    selector: 'nxa-test-near',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [Parts],
    providers: [provideToolUi({ toolName: 'weather', component: Second })],
    template: `<nxa-test-parts />`,
  })
  class NearWeather {}

  @Component({
    selector: 'nxa-test-near-fallback',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [Parts],
    providers: [provideToolUi({ fallback: Fallback })],
    template: `<nxa-test-parts />`,
  })
  class NearFallback {}

  function nearWeatherHost(store: Store, outer: unknown[]) {
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NearWeather],
      providers: [store.provider, ...(outer as never[])],
      template: `<nxa-test-near />`,
    })
    class Host {}
    return Host;
  }

  function nearFallbackHost(store: Store, outer: unknown[]) {
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NearFallback],
      providers: [store.provider, ...(outer as never[])],
      template: `<nxa-test-near-fallback />`,
    })
    class Host {}
    return Host;
  }

  it('prefers the nearer level, and reaches the levels above it', async () => {
    const store = createStore([
      assistant([toolCall('weather'), toolCall('search', { toolCallId: 'call-2' })]),
    ]);
    const fixture = render(
      nearWeatherHost(store, [
        provideToolUi({ toolName: 'weather', component: First }),
        provideToolUi({ toolName: 'search', component: Fallback }),
      ]),
    );
    await settle(fixture);

    expect(query(fixture, 'span.second')).not.toBeNull();
    expect(query(fixture, 'span.first')).toBeNull();
    expect(query(fixture, 'i.fallback')?.textContent).toBe('search');
  });

  it('looks a tool name up through every level before using a fallback', async () => {
    const store = createStore([
      assistant([toolCall('weather'), toolCall('search', { toolCallId: 'call-2' })]),
    ]);
    const fixture = render(
      nearFallbackHost(store, [provideToolUi({ toolName: 'weather', component: First })]),
    );
    await settle(fixture);

    expect(query(fixture, 'span.first')).not.toBeNull();
    expect(query(fixture, 'i.fallback')?.textContent).toBe('search');
  });

  it('reaches application level declarations from an assistant scope', async () => {
    TestBed.configureTestingModule({
      providers: [provideToolUi({ toolName: 'weather', component: First })],
    });
    const store = createStore([assistant([toolCall('weather')])]);
    const fixture = render(partsHost(store));
    await settle(fixture);
    expect(query(fixture, 'span.first')).not.toBeNull();
  });

  it('lets a nested assistant scope use the UIs of the outer one', async () => {
    const outer = createStore([]);
    const inner = createStore([assistant([toolCall('weather')])]);
    TestBed.configureTestingModule({ providers: [{ provide: RIGHT_STORE, useValue: inner }] });
    const fixture = render(nestedHost(outer));
    await settle(fixture);
    expect(query(fixture, 'nxa-test-right span.slot')).not.toBeNull();

    fixture.componentInstance.registry.register('weather', First);
    await settle(fixture);
    expect(query(fixture, 'nxa-test-right span.first')).not.toBeNull();
  });

  it('keeps the runtime registrations of two assistants apart', async () => {
    const left = createStore([assistant([toolCall('weather')])]);
    const right = createStore([assistant([toolCall('weather')])]);
    TestBed.configureTestingModule({
      providers: [
        { provide: LEFT_STORE, useValue: left },
        { provide: RIGHT_STORE, useValue: right },
      ],
    });
    const fixture = render(TwoAssistants);
    await settle(fixture);

    const leftPane = fixture.debugElement.query((el) => el.name === 'nxa-test-left')
      .componentInstance as LeftPane;
    leftPane.registry.register('weather', First);
    await settle(fixture);

    expect(query(fixture, 'nxa-test-left span.first')).not.toBeNull();
    expect(query(fixture, 'nxa-test-right span.first')).toBeNull();
    expect(query(fixture, 'nxa-test-right span.slot')).not.toBeNull();
  });
});

describe('injectToolCall', () => {
  @Component({
    selector: 'nxa-test-probe',
    template: `{{ label }}`,
  })
  class Probe {
    readonly tool = injectToolCall({ optional: true });
    readonly part = injectPart();
    readonly label = this.tool
      ? `tool:${this.tool.args()['city']}`
      : `none:${this.part.getState().type}`;
  }

  it('is the call of a tool-call part in the template, and null for other parts', async () => {
    const store = createStore([assistant([{ type: 'text', text: 'hi' }, toolCall('weather')])]);
    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      imports: [NxaMessages, NxaMessageParts, Probe],
      providers: [store.provider],
      template: `<div *nxaMessages><nxa-test-probe *nxaMessageParts /></div>`,
    })
    class Host {}
    const fixture = render(Host);
    await settle(fixture);

    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('nxa-test-probe'),
    ).map((el) => el.textContent);
    expect(labels).toEqual(['none:text', 'tool:sf']);
  });

  it('throws outside a tool call scope unless optional', () => {
    @Component({ template: `` })
    class Outside {
      readonly tool = injectToolCall();
    }
    expect(() => TestBed.createComponent(Outside)).toThrow(/No tool call scope here/);
  });

  it('has no registry outside an assistant scope without provideToolUi', () => {
    @Component({ template: `` })
    class Outside {
      readonly registry = injectToolUiRegistry();
    }
    expect(() => TestBed.createComponent(Outside)).toThrow(/No tool UI registry here/);
  });
});
