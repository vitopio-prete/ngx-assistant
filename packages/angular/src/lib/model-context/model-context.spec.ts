import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  type Provider,
  createEnvironmentInjector,
  input,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  AssistantRuntime,
  ChatModelAdapter,
  ModelContext,
  RemoteThreadListAdapter,
  RemoteThreadMetadata,
} from '@ngx-assistant/engine';
import { provideDataStreamRuntime } from '../data-stream';
import { provideLocalRuntime } from '../local-runtime';
import { provideRemoteThreadListRuntime } from '../remote-thread-list';
import { injectAssistant } from '../scopes';
import { NXA_TOOL_UI_REGISTRY, provideToolUi } from '../tools/tool-ui-registry';
import { injectAssistantContext, injectAssistantInstructions } from './assistant-instructions';
import { injectAssistantTool, type AssistantTool } from './assistant-tool';
import { injectModelContext } from './model-context-state';

/** A model that records the model context of each run and replies with `reply`. */
const recordingModel = (reply = 'ok') => {
  const contexts: ModelContext[] = [];
  const model: ChatModelAdapter = {
    async *run({ context }) {
      contexts.push(context);
      yield { content: [{ type: 'text', text: reply }] };
    },
  };
  return { model, contexts };
};

const makeListAdapter = (): RemoteThreadListAdapter => ({
  list: async () => ({
    threads: [
      { status: 'regular', remoteId: 'thread-a' },
      { status: 'regular', remoteId: 'thread-b' },
    ] satisfies RemoteThreadMetadata[],
  }),
  initialize: async (threadId) => ({ remoteId: `remote-${threadId}` }),
  rename: async () => undefined,
  archive: async () => undefined,
  unarchive: async () => undefined,
  delete: async () => undefined,
  generateTitle: async () => new ReadableStream({ start: (c) => c.close() }) as never,
  fetch: async (remoteId) => ({ status: 'regular', remoteId }),
});

const injectorWith = (...providers: Provider[]) =>
  createEnvironmentInjector(providers, TestBed.inject(EnvironmentInjector));

/** A child injector of `parent` whose destruction ends what was registered in it. */
const childOf = (parent: EnvironmentInjector) => createEnvironmentInjector([], parent);

const waitFor = (predicate: () => boolean) => vi.waitFor(() => expect(predicate()).toBe(true));

const send = async (assistant: AssistantRuntime, text: string, runs: () => number) => {
  const before = runs();
  assistant.thread.append(text);
  await waitFor(() => runs() === before + 1 && !assistant.thread.getState().isRunning);
};

const flushEffects = () => TestBed.tick();

const weather: AssistantTool<{ city: string }, string> = {
  toolName: 'get_weather',
  description: 'Get the weather of a city.',
  parameters: { type: 'object', properties: { city: { type: 'string' } } },
  execute: async ({ city }) => `sunny in ${city}`,
};

@Component({ selector: 'nxa-test-weather', template: 'weather' })
class WeatherCard {}

@Component({ selector: 'nxa-test-forecast', template: 'forecast' })
class ForecastCard {}

describe('injectAssistantTool', () => {
  it('adds the tool to every run while its injector lives', async () => {
    const { model, contexts } = recordingModel();
    const injector = injectorWith(provideLocalRuntime(model));
    const assistant = injector.runInContext(() => injectAssistant());
    const owner = childOf(injector);
    owner.runInContext(() => injectAssistantTool(weather));

    await send(assistant, 'one', () => contexts.length);
    expect(Object.keys(contexts[0]!.tools ?? {})).toEqual(['get_weather']);
    expect(contexts[0]!.tools!['get_weather']).toMatchObject({
      description: 'Get the weather of a city.',
    });

    owner.destroy();
    await send(assistant, 'two', () => contexts.length);
    expect(contexts[1]!.tools).toBeUndefined();
    injector.destroy();
  });

  it('follows a tool given as a function of signals', async () => {
    const { model, contexts } = recordingModel();
    const injector = injectorWith(provideLocalRuntime(model));
    const assistant = injector.runInContext(() => injectAssistant());
    const description = signal('first');
    const updates = vi.fn();
    assistant.thread.unstable_on('modelContextUpdate', updates);
    injector.runInContext(() =>
      injectAssistantTool(() => ({ ...weather, description: description() })),
    );
    updates.mockClear();

    flushEffects();
    expect(updates).not.toHaveBeenCalled();

    description.set('second');
    flushEffects();
    expect(updates).toHaveBeenCalledOnce();

    await send(assistant, 'hi', () => contexts.length);
    expect(contexts[0]!.tools!['get_weather']).toMatchObject({ description: 'second' });
    injector.destroy();
  });

  it('keeps the latest value when it changes more than once before a send', async () => {
    const { model, contexts } = recordingModel();
    const injector = injectorWith(provideLocalRuntime(model));
    const assistant = injector.runInContext(() => injectAssistant());
    const description = signal('a');
    injector.runInContext(() =>
      injectAssistantTool(() => ({ ...weather, description: description() })),
    );

    description.set('b');
    flushEffects();
    description.set('c');

    // A send before the effect ran still reads the latest value.
    await send(assistant, 'hi', () => contexts.length);
    expect(contexts[0]!.tools!['get_weather']).toMatchObject({ description: 'c' });
    injector.destroy();
  });

  it('never sends render to the model, and registers it as the UI of the tool', async () => {
    const { model, contexts } = recordingModel();
    const injector = injectorWith(provideLocalRuntime(model));
    const assistant = injector.runInContext(() => injectAssistant());
    const registry = injector.get(NXA_TOOL_UI_REGISTRY);
    const owner = childOf(injector);
    owner.runInContext(() => injectAssistantTool({ ...weather, render: WeatherCard }));

    expect(registry.resolve('get_weather')).toBe(WeatherCard);
    await send(assistant, 'hi', () => contexts.length);
    expect(contexts[0]!.tools!['get_weather']).not.toHaveProperty('render');
    expect(contexts[0]!.tools!['get_weather']).not.toHaveProperty('toolName');

    owner.destroy();
    expect(registry.resolve('get_weather')).toBeNull();
    injector.destroy();
  });

  it('moves the UI registration when the name or the component changes', () => {
    const injector = injectorWith(provideLocalRuntime(recordingModel().model));
    const registry = injector.get(NXA_TOOL_UI_REGISTRY);
    const tool = signal<AssistantTool<{ city: string }, string>>({
      ...weather,
      render: WeatherCard,
    });
    injector.runInContext(() => injectAssistantTool(() => tool()));

    tool.set({ ...weather, render: ForecastCard });
    flushEffects();
    expect(registry.resolve('get_weather')).toBe(ForecastCard);

    tool.set({ ...weather, toolName: 'get_forecast', render: ForecastCard });
    flushEffects();
    expect(registry.resolve('get_weather')).toBeNull();
    expect(registry.resolve('get_forecast')).toBe(ForecastCard);

    tool.set({ ...weather, toolName: 'get_forecast' });
    flushEffects();
    expect(registry.resolve('get_forecast')).toBeNull();
    injector.destroy();
  });

  it('puts the UI on the registry of the runtime, past a nearer provideToolUi', async () => {
    @Component({
      selector: 'nxa-test-tool-owner-with-ui',
      providers: [provideToolUi({ toolName: 'other', component: ForecastCard })],
      template: '',
    })
    class ToolOwner {
      constructor() {
        injectAssistantTool({ ...weather, render: WeatherCard });
      }
    }

    TestBed.configureTestingModule({ providers: [provideLocalRuntime(recordingModel().model)] });
    const fixture = TestBed.createComponent(ToolOwner);
    fixture.detectChanges();

    expect(TestBed.inject(NXA_TOOL_UI_REGISTRY).resolve('get_weather')).toBe(WeatherCard);
    fixture.destroy();
    expect(TestBed.inject(NXA_TOOL_UI_REGISTRY).resolve('get_weather')).toBeNull();
  });

  it('reads the required inputs of the component that registers it', async () => {
    const { model, contexts } = recordingModel();

    @Component({ selector: 'nxa-test-input-tool', template: '' })
    class InputTool {
      readonly name = input.required<string>();
      constructor() {
        injectAssistantTool(() => ({ ...weather, toolName: this.name(), render: WeatherCard }));
        injectAssistantInstructions(() => `Use ${this.name()}.`);
      }
    }

    @Component({
      selector: 'nxa-test-input-tool-host',
      imports: [InputTool],
      template: '<nxa-test-input-tool [name]="name()" />',
    })
    class Host {
      readonly name = signal('lookup');
    }

    TestBed.configureTestingModule({ providers: [provideLocalRuntime(model)] });
    const assistant = TestBed.inject(EnvironmentInjector).runInContext(() => injectAssistant());
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();

    expect(TestBed.inject(NXA_TOOL_UI_REGISTRY).resolve('lookup')).toBe(WeatherCard);
    await send(assistant, 'one', () => contexts.length);
    expect(contexts[0]).toMatchObject({ system: 'Use lookup.' });
    expect(Object.keys(contexts[0]!.tools ?? {})).toEqual(['lookup']);

    fixture.componentInstance.name.set('search');
    await fixture.whenStable();
    expect(TestBed.inject(NXA_TOOL_UI_REGISTRY).resolve('lookup')).toBeNull();
    expect(TestBed.inject(NXA_TOOL_UI_REGISTRY).resolve('search')).toBe(WeatherCard);
    await send(assistant, 'two', () => contexts.length);
    expect(Object.keys(contexts[1]!.tools ?? {})).toEqual(['search']);
  });

  it('notifies nothing once destroyed, even with a change the effect has not seen', () => {
    const injector = injectorWith(provideLocalRuntime(recordingModel().model));
    const assistant = injector.runInContext(() => injectAssistant());
    const owner = childOf(injector);
    const description = signal('a');
    owner.runInContext(() =>
      injectAssistantTool(() => ({ ...weather, description: description() })),
    );
    flushEffects();
    const updates = vi.fn();
    assistant.thread.unstable_on('modelContextUpdate', updates);

    description.set('b');
    owner.destroy();
    flushEffects();

    // One notification: the removal of the provider.
    expect(updates).toHaveBeenCalledOnce();
    expect(assistant.thread.getModelContext().tools).toBeUndefined();
    injector.destroy();
  });

  it('throws outside a runtime', () => {
    const injector = injectorWith();
    expect(() => injector.runInContext(() => injectAssistantTool(weather))).toThrow(
      /No assistant scope/,
    );
    injector.destroy();
  });

  it('registers from a component, removed when the component is destroyed', async () => {
    const { model, contexts } = recordingModel();

    @Component({
      selector: 'nxa-test-tool-owner',
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: '',
    })
    class ToolOwner {
      constructor() {
        injectAssistantTool(weather);
        injectAssistantInstructions('Be brief.');
      }
    }

    TestBed.configureTestingModule({ providers: [provideLocalRuntime(model)] });
    const assistant = TestBed.inject(EnvironmentInjector).runInContext(() => injectAssistant());
    const fixture = TestBed.createComponent(ToolOwner);
    fixture.detectChanges();

    await send(assistant, 'one', () => contexts.length);
    expect(contexts[0]).toMatchObject({ system: 'Be brief.' });
    expect(Object.keys(contexts[0]!.tools ?? {})).toEqual(['get_weather']);

    fixture.destroy();
    await send(assistant, 'two', () => contexts.length);
    expect(contexts[1]!.system).toBeUndefined();
    expect(contexts[1]!.tools).toBeUndefined();
  });
});

describe('injectAssistantInstructions', () => {
  it('joins the instructions into the system prompt', async () => {
    const { model, contexts } = recordingModel();
    const injector = injectorWith(provideLocalRuntime(model));
    const assistant = injector.runInContext(() => injectAssistant());
    injector.runInContext(() => {
      injectAssistantInstructions('Answer in Italian.');
      injectAssistantInstructions({ instruction: 'Be brief.' });
      injectAssistantInstructions({ instruction: 'Never shown.', disabled: true });
    });

    await send(assistant, 'hi', () => contexts.length);
    expect(contexts[0]!.system).toBe('Answer in Italian.\n\nBe brief.');
    injector.destroy();
  });

  it('follows an instruction given as a function of signals, disabled included', async () => {
    const { model, contexts } = recordingModel();
    const injector = injectorWith(provideLocalRuntime(model));
    const assistant = injector.runInContext(() => injectAssistant());
    const name = signal('Ada');
    const disabled = signal(false);
    injector.runInContext(() =>
      injectAssistantInstructions(() => ({
        instruction: `The user is ${name()}.`,
        disabled: disabled(),
      })),
    );

    await send(assistant, 'one', () => contexts.length);
    name.set('Linus');
    await send(assistant, 'two', () => contexts.length);
    disabled.set(true);
    await send(assistant, 'three', () => contexts.length);

    expect(contexts.map((c) => c.system)).toEqual([
      'The user is Ada.',
      'The user is Linus.',
      undefined,
    ]);
    injector.destroy();
  });
});

describe('injectAssistantContext', () => {
  it('reads the context on every send', async () => {
    const { model, contexts } = recordingModel();
    const injector = injectorWith(provideLocalRuntime(model));
    const assistant = injector.runInContext(() => injectAssistant());
    let page = 'home';
    const getContext = vi.fn(() => `The page is ${page}.`);
    injector.runInContext(() => injectAssistantContext({ getContext }));

    await send(assistant, 'one', () => contexts.length);
    page = 'settings';
    await send(assistant, 'two', () => contexts.length);

    expect(contexts.map((c) => c.system)).toEqual(['The page is home.', 'The page is settings.']);
    injector.destroy();
  });

  it('leaves the context out while disabled', async () => {
    const { model, contexts } = recordingModel();
    const injector = injectorWith(provideLocalRuntime(model));
    const assistant = injector.runInContext(() => injectAssistant());
    const disabled = signal(true);
    const getContext = vi.fn(() => 'context');
    injector.runInContext(() =>
      injectAssistantContext(() => ({ getContext, disabled: disabled() })),
    );

    await send(assistant, 'one', () => contexts.length);
    expect(getContext).not.toHaveBeenCalled();
    disabled.set(false);
    await send(assistant, 'two', () => contexts.length);

    expect(contexts.map((c) => c.system)).toEqual([undefined, 'context']);
    injector.destroy();
  });
});

describe('injectModelContext', () => {
  it('follows the model name and the tool names', () => {
    const injector = injectorWith(provideLocalRuntime(recordingModel().model));
    const state = injector.runInContext(() => injectModelContext());
    const initial = state();
    expect(initial).toEqual({ modelName: undefined, toolNames: [] });

    const owner = childOf(injector);
    owner.runInContext(() => {
      injectAssistantTool({ ...weather, toolName: 'zeta' });
      injectAssistantTool(weather);
    });
    expect(state().toolNames).toEqual(['get_weather', 'zeta']);

    const assistant = injector.runInContext(() => injectAssistant());
    const unregister = assistant.registerModelContextProvider({
      getModelContext: () => ({ config: { modelName: 'large' } }),
    });
    expect(state().modelName).toBe('large');

    unregister();
    owner.destroy();
    expect(state()).toEqual({ modelName: undefined, toolNames: [] });
    injector.destroy();
  });

  it('follows the switch to another thread of a list', async () => {
    const injector = injectorWith(
      provideRemoteThreadListRuntime({
        adapter: makeListAdapter(),
        runtime: () => [provideLocalRuntime(recordingModel().model)],
      }),
    );
    const assistant = injector.runInContext(() => injectAssistant());
    const state = injector.runInContext(() => injectModelContext());
    await assistant.threads.switchToThread('thread-a');
    const unregister = assistant.registerModelContextProvider({
      getModelContext: () => ({ config: { modelName: 'large' } }),
    });
    expect(state().modelName).toBe('large');

    await assistant.threads.switchToThread('thread-b');
    expect(state().modelName).toBe('large');
    unregister();
    expect(state().modelName).toBeUndefined();
    injector.destroy();
  });

  it('keeps the same state when an unrelated part of the context changes', () => {
    const injector = injectorWith(provideLocalRuntime(recordingModel().model));
    const state = injector.runInContext(() => injectModelContext());
    const before = state();

    injector.runInContext(() => injectAssistantInstructions('Be brief.'));

    expect(state()).toBe(before);
    injector.destroy();
  });
});

const uiMessageStream = (chunks: readonly Record<string, unknown>[]) =>
  new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
    { headers: { 'x-vercel-ai-ui-message-stream': 'v1' } },
  );

const textReply = (text: string) => [
  { type: 'start', messageId: 'reply' },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: text },
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: 'stop' },
];

const toolCallReply = (toolName: string, input: unknown) => [
  { type: 'start', messageId: 'reply' },
  { type: 'tool-input-start', toolCallId: 'call-1', toolName },
  { type: 'tool-input-available', toolCallId: 'call-1', toolName, input },
  { type: 'finish', finishReason: 'tool-calls' },
];

describe('model context with backends', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends the tools, the system prompt and the config to a data stream backend', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => uiMessageStream(textReply('hi')));
    vi.stubGlobal('fetch', fetchMock);
    const injector = injectorWith(provideDataStreamRuntime({ api: '/api/chat' }));
    const assistant = injector.runInContext(() => injectAssistant());
    injector.runInContext(() => {
      injectAssistantTool(weather);
      injectAssistantInstructions('Be brief.');
    });
    assistant.registerModelContextProvider({
      getModelContext: () => ({ config: { modelName: 'large' } }),
    });

    await send(assistant, 'hi', () => fetchMock.mock.calls.length);

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      system: 'Be brief.',
      modelName: 'large',
      tools: { get_weather: { description: 'Get the weather of a city.' } },
    });
    injector.destroy();
  });

  it('runs execute in the browser and sends the result to the backend', async () => {
    const replies = [toolCallReply('get_weather', { city: 'Rome' }), textReply('It is sunny')];
    const fetchMock = vi.fn<typeof fetch>(async () => uiMessageStream(replies.shift()!));
    vi.stubGlobal('fetch', fetchMock);
    const injector = injectorWith(provideDataStreamRuntime({ api: '/api/chat' }));
    const assistant = injector.runInContext(() => injectAssistant());
    const execute = vi.fn(weather.execute!);
    injector.runInContext(() => injectAssistantTool({ ...weather, execute }));

    assistant.thread.append('weather?');
    await waitFor(
      () => fetchMock.mock.calls.length === 2 && !assistant.thread.getState().isRunning,
    );

    expect(execute).toHaveBeenCalledWith({ city: 'Rome' }, expect.anything());
    const last = assistant.thread.getState().messages.at(-1)!;
    expect(last.content).toContainEqual(
      expect.objectContaining({ type: 'tool-call', result: 'sunny in Rome' }),
    );
    injector.destroy();
  });

  it('reaches every thread of a remote thread list when registered on the list', async () => {
    const { model, contexts } = recordingModel();
    const adapter = makeListAdapter();
    const injector = injectorWith(
      provideRemoteThreadListRuntime({ adapter, runtime: () => provideLocalRuntime(model) }),
    );
    const assistant = injector.runInContext(() => injectAssistant());
    injector.runInContext(() => injectAssistantInstructions('Shared.'));

    await assistant.threads.switchToThread('thread-a');
    await send(assistant, 'in a', () => contexts.length);
    await assistant.threads.switchToThread('thread-b');
    await send(assistant, 'in b', () => contexts.length);

    expect(contexts.map((c) => c.system)).toEqual(['Shared.', 'Shared.']);
    injector.destroy();
  });
});
