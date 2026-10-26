import { DestroyRef, inject } from '@angular/core';
import {
  AssistantRuntimeImpl,
  LocalRuntimeCore,
  type AssistantRuntime,
  type ChatModelAdapter,
  type LocalRuntimeOptionsBase,
  type ThreadMessageLike,
} from '@ngx-assistant/engine';
import { NXA_RUNTIME_ADAPTERS } from './runtime-adapters';

export type LocalRuntimeOptions = Omit<LocalRuntimeOptionsBase, 'adapters'> & {
  /** Messages the thread starts with. A history adapter that loads messages replaces them. */
  initialMessages?: readonly ThreadMessageLike[] | undefined;
  adapters?: Omit<LocalRuntimeOptionsBase['adapters'], 'chatModel'> | undefined;
};

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
 * Creates a runtime that runs the chat in the browser through `chatModel` and ties it to the
 * current injector. Shared by every provider built on the local runtime; not part of the public
 * API. Must run in an injection context.
 *
 * Inside a thread of a remote thread list, the list's adapters (`NXA_RUNTIME_ADAPTERS`) are merged
 * under the runtime's own and its model context is registered on the runtime.
 *
 * Creating the runtime owns its lifecycle, which the runtime API does not expose: the main thread
 * core loads the history once and is detached when the injector is destroyed, after voice,
 * dictation and speech end.
 */
export function createLocalAssistantRuntime(
  chatModel: ChatModelAdapter,
  options: LocalRuntimeOptions,
): { runtime: AssistantRuntime; core: LocalRuntimeCore } {
  const { initialMessages, adapters, ...rest } = options;
  const { modelContext, ...listAdapters } = inject(NXA_RUNTIME_ADAPTERS, { optional: true }) ?? {};
  const core = new LocalRuntimeCore(
    { ...rest, adapters: { ...listAdapters, ...adapters, chatModel } },
    initialMessages,
  );
  const runtime = new AssistantRuntimeImpl(core);
  const unregisterModelContext = modelContext
    ? runtime.registerModelContextProvider(modelContext)
    : undefined;

  const thread = core.threads.getMainThreadRuntimeCore();
  inject(DestroyRef).onDestroy(() => {
    unregisterModelContext?.();
    endMediaSessions(runtime);
    thread.detach();
  });
  thread.__internal_load().catch((error: unknown) => {
    console.error('[ngx-assistant] local thread history load failed:', error);
  });
  return { runtime, core };
}
