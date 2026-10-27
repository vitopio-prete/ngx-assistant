import type { AssistantContextConfig, AssistantInstructionsConfig } from '@ngx-assistant/engine';
import { injectAssistant } from '../scopes';
import {
  readMaybeReactive,
  registerModelContext,
  type MaybeReactive,
} from './model-context-binding';

const NO_CONTEXT = () => ({});

/**
 * Adds an instruction to the system prompt of the nearest runtime while the current injector
 * lives. `disabled` leaves it out. Pass a function that reads signals to change it over time; the
 * next send uses the latest value. Must run in an injection context.
 *
 * @example
 * ```ts
 * injectAssistantInstructions('Answer in Italian.');
 * injectAssistantInstructions(() => ({ instruction: `The user is ${user().name}.`, disabled: !user() }));
 * ```
 */
export function injectAssistantInstructions(
  config: MaybeReactive<string | AssistantInstructionsConfig>,
): void {
  registerModelContext(injectAssistant(), () => {
    const value = readMaybeReactive(config);
    const { instruction, disabled = false } =
      typeof value === 'string' ? { instruction: value } : value;
    if (disabled) return NO_CONTEXT;
    const context = { system: instruction };
    return () => context;
  });
}

/**
 * Adds to the system prompt of the nearest runtime, while the current injector lives, the text
 * that `getContext` returns when the runtime asks for it, on every send: for example the state of
 * the page the user is looking at. `disabled` leaves it out; pass a function that reads signals to
 * switch it. Must run in an injection context.
 *
 * @example
 * ```ts
 * injectAssistantContext({ getContext: () => `The open document is "${document().title}".` });
 * ```
 */
export function injectAssistantContext(config: MaybeReactive<AssistantContextConfig>): void {
  registerModelContext(injectAssistant(), () => {
    const { getContext, disabled = false } = readMaybeReactive(config);
    if (disabled) return NO_CONTEXT;
    return () => ({ system: getContext() });
  });
}
