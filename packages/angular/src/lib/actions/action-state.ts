import { Signal, computed } from '@angular/core';
import type { MessageRuntime, ThreadRuntime } from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';

/**
 * Whether a message cannot be edited: it is being edited already, or the thread is disabled, runs
 * a voice session or does not support edits.
 */
export function editDisabled(thread: ThreadRuntime, message: MessageRuntime): Signal<boolean> {
  const threadBlocks = fromRuntime(
    thread,
    (s) => s.isDisabled || s.voice !== undefined || s.capabilities.edit === false,
  );
  const isEditing = fromRuntime(message.composer, (s) => s.isEditing);
  return computed(() => threadBlocks() || isEditing());
}

/**
 * Whether a message cannot be regenerated: it is not an assistant message, or the thread is
 * running, disabled, in a voice session or does not support reloads.
 */
export function reloadDisabled(thread: ThreadRuntime, message: MessageRuntime): Signal<boolean> {
  const threadBlocks = fromRuntime(
    thread,
    (s) => s.isRunning || s.isDisabled || s.voice !== undefined || !s.capabilities.reload,
  );
  const notAssistant = fromRuntime(message, (s) => s.role !== 'assistant');
  return computed(() => threadBlocks() || notAssistant());
}

/** Whether a message has nothing to copy: it is an assistant message still running, or has no text. */
export function copyDisabled(message: MessageRuntime): Signal<boolean> {
  return fromRuntime(
    message,
    (s) =>
      (s.role === 'assistant' && s.status?.type === 'running') ||
      !s.content.some((part) => part.type === 'text' && part.text.length > 0),
  );
}

/**
 * Whether a message cannot move to its previous or next branch: there is none in that direction,
 * the thread does not switch branches, or a run is in flight and the runtime does not switch
 * branches during runs.
 */
export function branchDisabled(
  thread: ThreadRuntime,
  message: MessageRuntime,
  position: 'previous' | 'next',
): Signal<boolean> {
  const threadBlocks = fromRuntime(
    thread,
    (s) => !s.capabilities.switchToBranch || (s.isRunning && !s.capabilities.switchBranchDuringRun),
  );
  const atEnd = fromRuntime(message, (s) =>
    position === 'previous' ? s.branchNumber <= 1 : s.branchNumber >= s.branchCount,
  );
  return computed(() => threadBlocks() || atEnd());
}
