import { Provider } from '@angular/core';
import type { ChatModelAdapter } from '@ngx-assistant/engine';
import { createLocalAssistantRuntime, type LocalRuntimeOptions } from './create-local-runtime';
import { provideAssistantScope } from './scopes';

export type { LocalRuntimeOptions } from './create-local-runtime';

type Injectable<T> = T | (() => T);

const resolve = <T extends object>(value: Injectable<T>): T =>
  typeof value === 'function' ? (value as () => T)() : value;

/**
 * Provides a runtime that runs the chat in the browser through `chatModel`, plus the assistant,
 * thread and composer scopes, to an injector: `providers` of a component, a route or the app.
 *
 * `chatModel` and `options` can be factories, run in the injection context, so an adapter can
 * `inject()` its own dependencies. They are read once, when the runtime is first injected. When
 * the injector is destroyed, the running stream is aborted, voice, dictation and speech end, and
 * the thread is detached.
 *
 * @example
 * ```ts
 * providers: [provideLocalRuntime(() => inject(MyChatModel), { maxSteps: 3 })]
 * ```
 */
export function provideLocalRuntime(
  chatModel: Injectable<ChatModelAdapter>,
  options: Injectable<LocalRuntimeOptions> = {},
): Provider[] {
  return provideAssistantScope(() => {
    const resolvedOptions = resolve(options);
    return createLocalAssistantRuntime(resolve(chatModel), resolvedOptions).runtime;
  });
}
