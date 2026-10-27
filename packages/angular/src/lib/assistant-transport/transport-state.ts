import { Signal, inject } from '@angular/core';
import type { UserExternalState } from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';
import { injectAssistant, injectThread } from '../scopes';
import { NXA_TRANSPORT_INITIAL_STATE, transportExtrasOf } from './transport-extras';
import type { AssistantTransportCommand } from './types';

/**
 * The agent state of the nearest assistant transport thread, as a `Signal`. It follows the thread
 * the runtime shows. With a selector, the signal holds what the selector returns and notifies only
 * when that changes. The state type defaults to the one declared with module augmentation of
 * `Assistant.ExternalState` in `@ngx-assistant/engine`.
 *
 * Right after the runtime is created its first thread takes a moment to start: meanwhile the
 * signal holds the selection of `initialState`. Inside a thread list of
 * `provideRemoteThreadListRuntime`, which does not know that state, it holds `undefined` and the
 * selector is not called. Reading the signal throws when the thread runs on another runtime.
 *
 * @example
 * ```ts
 * readonly todos = injectAssistantTransportState((state: AgentState) => state.todos);
 * ```
 */
export function injectAssistantTransportState<S = UserExternalState>(): Signal<S>;
export function injectAssistantTransportState<R, S = UserExternalState>(
  selector: (state: S) => R,
): Signal<R>;
export function injectAssistantTransportState<R, S>(
  selector: (state: S) => R = (state) => state as unknown as R,
): Signal<R> {
  const thread = injectThread();
  const assistant = injectAssistant();
  const initial = inject(NXA_TRANSPORT_INITIAL_STATE, { optional: true });
  const initialState = initial?.initialState;
  return fromRuntime(thread, ({ extras, isLoading }) => {
    // A thread that has not started yet has no extras.
    if (extras === undefined && isLoading) {
      return initial?.assistant === assistant ? selector(initialState as S) : (undefined as R);
    }
    return selector(transportExtrasOf(extras).state as S);
  });
}

/**
 * A function that sends a command to the server of the nearest assistant transport thread: the
 * thread the runtime shows when it is called. A user `add-message` without an id gets one. The
 * command goes out with the next request, which starts at once when none is running. Throws when
 * the thread has not started yet or runs on another runtime.
 *
 * @example
 * ```ts
 * private readonly sendCommand = injectAssistantTransportSendCommand();
 * restart() {
 *   this.sendCommand({ type: 'restart-session' });
 * }
 * ```
 */
export function injectAssistantTransportSendCommand(): (
  command: AssistantTransportCommand,
) => void {
  const thread = injectThread();
  return (command) => transportExtrasOf(thread.getState().extras).sendCommand(command);
}
