import { computed, inject } from '@angular/core';
import type { AssistantToolProps } from '@ngx-assistant/engine';
import { injectAssistant } from '../scopes';
import { NXA_ASSISTANT_TOOL_UI_REGISTRY, type ToolUiComponent } from '../tools/tool-ui-registry';
import {
  bindLatest,
  readMaybeReactive,
  registerModelContext,
  type MaybeReactive,
} from './model-context-binding';

/**
 * A tool the model can call, with its name. A tool with `execute` runs in the browser and its
 * result goes back to the model; one without waits for the UI to answer it (`addResult`).
 * `render` is the component that renders its calls, as with `provideToolUi(...)`.
 */
export type AssistantTool<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
> = AssistantToolProps<TArgs, TResult> & {
  /** Component that renders the calls of this tool. It never reaches the model. */
  readonly render?: ToolUiComponent | undefined;
};

/**
 * Adds a tool to the model context of the nearest runtime while the current injector lives: the
 * tool reaches the model on every send of that runtime, or of every thread when the runtime is a
 * thread list. With `render`, its calls are also rendered with that component, registered on the
 * tool UI registry of that runtime, so it applies wherever the runtime's messages render. Pass a
 * function that reads signals to change the tool over time (it may read required inputs); the
 * runtime then sees the latest tool. Must run in an injection context.
 *
 * @example
 * ```ts
 * injectAssistantTool({
 *   toolName: 'get_weather',
 *   description: 'Get the weather of a city.',
 *   parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
 *   execute: async ({ city }) => fetchWeather(city as string),
 *   render: WeatherCard,
 * });
 * ```
 */
export function injectAssistantTool<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
>(tool: MaybeReactive<AssistantTool<TArgs, TResult>>): void {
  const runtime = injectAssistant();
  const registry = inject(NXA_ASSISTANT_TOOL_UI_REGISTRY, { optional: true });
  const current = computed(() => readMaybeReactive(tool));

  registerModelContext(runtime, () => {
    // `render` is a client concern and never reaches the model.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { toolName, render, ...definition } = current();
    const context = { tools: { [toolName]: definition } };
    return () => context;
  });

  const ui = computed(
    () => {
      const { toolName, render } = current();
      return render ? { toolName, render } : null;
    },
    { equal: (a, b) => a?.toolName === b?.toolName && a?.render === b?.render },
  );
  bindLatest(
    ui,
    (value) => {
      if (!value) return;
      if (!registry) {
        throw new Error(
          `[ngx-assistant] No tool UI registry for the render of tool "${value.toolName}": provide a runtime on an ancestor.`,
        );
      }
      return registry.register(value.toolName, value.render);
    },
    // A fixed tool shows its UI at once; a reactive one waits for the effect.
    { eager: typeof tool !== 'function' },
  );
}
