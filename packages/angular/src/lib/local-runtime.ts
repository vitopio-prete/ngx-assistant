import { DestroyRef, Provider, inject } from '@angular/core';
import {
  AssistantRuntimeImpl,
  LocalRuntimeCore,
  type AssistantRuntime,
  type ChatModelAdapter,
  type LocalRuntimeOptionsBase,
  type ThreadMessageLike,
} from '@ngx-assistant/engine';
import { provideAssistantScope } from './scopes';

export type LocalRuntimeOptions = Omit<LocalRuntimeOptionsBase, 'adapters'> & {
  /** Messages the thread starts with. A history adapter that loads messages replaces them. */
  initialMessages?: readonly ThreadMessageLike[] | undefined;
  adapters?: Omit<LocalRuntimeOptionsBase['adapters'], 'chatModel'> | undefined;
};

type Injectable<T> = T | (() => T);

const resolve = <T extends object>(value: Injectable<T>): T =>
  typeof value === 'function' ? (value as () => T)() : value;

const endMediaSession = (end: () => void, what: string) => {
  try {
    end();
  } catch (error) {
    console.error(`[ngx-assistant] ${what} cleanup threw while destroying the runtime`, error);
  }
};

// Once the injector is gone nothing can reach the runtime's controls, so the microphone and the
// playback end with it.
const endMediaSessions = ({ thread }: AssistantRuntime) => {
  const state = thread.getState();
  if (state.voice) endMediaSession(() => thread.disconnectVoice(), 'Voice');
  if (thread.composer.getState().dictation) {
    endMediaSession(() => thread.composer.stopDictation(), 'Dictation');
  }
  for (const { id } of state.messages) {
    const composer = thread.getMessageById(id).composer;
    if (composer.getState().dictation) endMediaSession(() => composer.stopDictation(), 'Dictation');
  }
  if (state.speech) endMediaSession(() => thread.stopSpeaking(), 'Speech');
};

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
    const { initialMessages, adapters, ...rest } = resolve(options);
    const core = new LocalRuntimeCore(
      { ...rest, adapters: { ...adapters, chatModel: resolve(chatModel) } },
      initialMessages,
    );
    const runtime = new AssistantRuntimeImpl(core);

    // Creating the runtime owns its lifecycle, which the runtime API does not expose: the main
    // thread core loads the history once and is detached when the injector is destroyed.
    const thread = core.threads.getMainThreadRuntimeCore();
    inject(DestroyRef).onDestroy(() => {
      endMediaSessions(runtime);
      thread.detach();
    });
    thread.__internal_load().catch((error: unknown) => {
      console.error('[ngx-assistant] local thread history load failed:', error);
    });
    return runtime;
  });
}
