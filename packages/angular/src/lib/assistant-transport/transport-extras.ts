import { InjectionToken } from '@angular/core';
import type { AssistantRuntime, UserExternalState } from '@ngx-assistant/engine';
import type { AssistantTransportCommand } from './types';

/** What an assistant transport thread exposes through the `extras` of its thread state. */
export interface TransportExtras {
  readonly sendCommand: (command: AssistantTransportCommand) => void;
  readonly state: unknown;
}

const brand = Symbol('ngx-assistant assistant transport extras');

export const provideTransportExtras = (extras: TransportExtras) => ({ [brand]: true, ...extras });

/**
 * The initial state of the transport that provides `assistant`, shown while its first thread has
 * not started yet.
 */
export const NXA_TRANSPORT_INITIAL_STATE = new InjectionToken<{
  assistant: AssistantRuntime;
  initialState: unknown;
} | null>('NXA_TRANSPORT_INITIAL_STATE');

const isTransportExtras = (extras: unknown): extras is TransportExtras =>
  typeof extras === 'object' && extras !== null && brand in extras;

/** Reads the transport extras of a thread state, or throws when the thread is no transport. */
export function transportExtrasOf(extras: unknown): TransportExtras & { state: UserExternalState } {
  if (isTransportExtras(extras)) {
    return extras as unknown as TransportExtras & { state: UserExternalState };
  }
  throw new Error(
    '[ngx-assistant] This thread does not run on an assistant transport, or has not started yet: ' +
      'provide one with provideAssistantTransportRuntime(...).',
  );
}
