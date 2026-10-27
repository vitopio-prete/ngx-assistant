import { Signal } from '@angular/core';
import type { ModelContext } from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';
import { injectThread } from '../scopes';

/** What the UI usually needs from the model context of a thread. */
export interface ModelContextState {
  /** The model the runs ask for (`config.modelName`), if one is set. */
  readonly modelName: string | undefined;
  /** The names of the tools the model can call, sorted. */
  readonly toolNames: readonly string[];
}

const NO_TOOLS: readonly string[] = [];

const toState = (context: ModelContext): ModelContextState => {
  const names = context.tools ? Object.keys(context.tools).sort() : NO_TOOLS;
  return {
    modelName: context.config?.modelName,
    toolNames: names.length > 0 ? names : NO_TOOLS,
  };
};

const sameState = (a: ModelContextState, b: ModelContextState) =>
  a.modelName === b.modelName &&
  a.toolNames.length === b.toolNames.length &&
  a.toolNames.every((name, i) => name === b.toolNames[i]);

/**
 * The model name and tool names of the model context of the nearest thread, as a signal. It
 * follows every change of the context (`modelContextUpdate`), including a switch to another
 * thread. Must run in an injection context.
 *
 * @example
 * ```ts
 * readonly modelContext = injectModelContext();
 * readonly modelName = computed(() => this.modelContext().modelName);
 * ```
 */
export function injectModelContext(): Signal<ModelContextState> {
  const thread = injectThread();
  return fromRuntime(
    {
      getState: () => thread.getModelContext(),
      subscribe: (callback) => thread.unstable_on('modelContextUpdate', callback),
    },
    toState,
    { equal: sameState },
  );
}
