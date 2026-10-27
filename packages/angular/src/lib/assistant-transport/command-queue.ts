import type { AssistantTransportCommand, CommandQueueState } from './types';

const initialState = (): CommandQueueState => ({ queued: [], inTransit: [] });

/**
 * The commands waiting for the server. `flush` moves the queued ones in transit, where they stay
 * until the server confirms them (`markDelivered`). Each change replaces `state`, so its identity
 * tells whether the queue changed.
 */
export class CommandQueue {
  private _state = initialState();

  constructor(
    private readonly callbacks: {
      /** Called by `enqueue` unless it is told not to schedule. */
      onQueue: () => void;
      /** Called after every change of `state`. */
      onChange?: () => void;
    },
  ) {}

  get state(): CommandQueueState {
    return this._state;
  }

  enqueue(command: AssistantTransportCommand, options?: { schedule?: boolean }): void {
    this.set({ queued: [...this._state.queued, command], inTransit: this._state.inTransit });
    if (options?.schedule !== false) this.callbacks.onQueue();
  }

  flush(): AssistantTransportCommand[] {
    const { queued } = this._state;
    if (queued.length === 0) return [];
    this.set({ queued: [], inTransit: [...this._state.inTransit, ...queued] });
    return queued;
  }

  markDelivered(): void {
    this.set({ ...this._state, inTransit: [] });
  }

  reset(): void {
    this.set(initialState());
  }

  private set(state: CommandQueueState) {
    this._state = state;
    this.callbacks.onChange?.();
  }
}
