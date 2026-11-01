import { InjectionToken } from '@angular/core';
import type { MessageRuntime, ThreadRuntime } from '@ngx-assistant/engine';

/** The events that primitives report themselves, since no runtime call carries them. */
export type MessageUiEventName =
  'message.copied' | 'message.speak' | 'message.reload' | 'message.branchSwitched';

export interface MessageUiEvent {
  readonly name: MessageUiEventName;
  readonly threadId: string;
  readonly messageId: string;
}

type Listener = (event: MessageUiEvent) => void;

/** The UI events of one assistant scope. Listeners are called synchronously, in order. */
export class MessageUiEvents {
  private readonly listeners = new Set<Listener>();

  on(listener: Listener): () => void {
    // A wrapper, so the same function can listen twice and leave once.
    const entry: Listener = (event) => listener(event);
    this.listeners.add(entry);
    return () => this.listeners.delete(entry);
  }

  emit(event: MessageUiEvent) {
    for (const listener of [...this.listeners]) listener(event);
  }
}

/** Provided with every assistant scope; not part of the public API. */
export const NXA_MESSAGE_UI_EVENTS = new InjectionToken<MessageUiEvents | null>(
  'NXA_MESSAGE_UI_EVENTS',
);

/**
 * Reports a UI event of `message`, read at call time. Without an events bus (a hand-made scope)
 * it does nothing.
 */
export function emitMessageUiEvent(
  events: MessageUiEvents | null,
  thread: ThreadRuntime,
  message: MessageRuntime,
  name: MessageUiEventName,
) {
  if (!events) return;
  events.emit({ name, threadId: thread.getState().threadId, messageId: message.getState().id });
}
