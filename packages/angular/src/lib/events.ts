import {
  DestroyRef,
  ErrorHandler,
  Injector,
  assertInInjectionContext,
  inject,
  runInInjectionContext,
} from '@angular/core';
import type {
  AttachmentAddErrorReason,
  ComposerRuntime,
  MessageRuntime,
  MessageStatus,
  ThreadListRuntime,
  ThreadRuntime,
  Unsubscribe,
} from '@ngx-assistant/engine';
import {
  NXA_MESSAGE,
  injectAssistant,
  injectComposer,
  injectMessage,
  injectThread,
} from './scopes';

/** The events `injectNxaEvent()` delivers, by name, with their payloads. */
export interface NxaEvents {
  /** A run started on the thread. Also observable as `isRunning` turning `true`. */
  'thread.runStart': { threadId: string };
  /** A run ended: completed, failed or cancelled. Also observable as `isRunning` turning `false`. */
  'thread.runEnd': { threadId: string };
  /**
   * The thread went from new to initialized, before its first message is added. A subscription
   * that starts on, or follows the selection to, an initialized thread receives it once too.
   */
  'thread.initialize': { threadId: string };
  /** The model context changed. It lives outside the thread state, so only this event reports it. */
  'thread.modelContextUpdate': { threadId: string };
  /** The history adapter failed to persist a change. */
  'thread.historyWriteError': {
    threadId: string;
    operation: 'append' | 'update' | 'delete';
    messageIds: readonly string[];
    message: string;
  };
  /** A tool call that asked for approval was approved or denied. */
  'thread.toolApprovalAnswered': {
    threadId: string;
    messageId: string;
    toolCallId: string;
    toolName: string;
    approved: boolean;
  };
  /**
   * A composer sent a message. For the send that ends an edit, `messageId` is the edited message,
   * which the new branch has replaced by the time the callback runs.
   * `thread.append(...)` is not reported, since it does not go through a composer.
   */
  'composer.send': { threadId: string; messageId?: string; chars: number; attachments: number };
  /** An attachment was added to a composer. `messageId` is set for the edit composer of a message. */
  'composer.attachmentAdd': { threadId: string; messageId?: string; contentType?: string };
  /** An attachment could not be added to a composer. */
  'composer.attachmentAddError': {
    threadId: string;
    messageId?: string;
    attachmentId?: string;
    reason: AttachmentAddErrorReason;
    message: string;
    contentType?: string;
  };
  /** A message entered the error status. */
  'message.error': { threadId: string; messageId: string; reason: 'error' };
  /** The main thread changed. It does not fire for the thread selected at first. */
  'threads.selectionChanged': { threadId: string; previousThreadId: string };
}

export type NxaEventName = keyof NxaEvents;

type EventSource<E extends NxaEventName> = E extends `${infer S}.${string}` ? S : never;

interface ScopesBySource {
  thread: 'thread' | 'threads';
  composer: 'composer' | 'message' | 'thread' | 'threads';
  message: 'message' | 'thread' | 'threads';
  threads: 'threads';
}

/**
 * Where an event is heard: its own scope, one that contains it, or `'*'` for the whole assistant.
 * `'threads'` and `'*'` both reach the whole nearest assistant: its main thread and, for the run,
 * initialization and model context events, the threads a thread list keeps alive.
 */
export type NxaEventScope<E extends NxaEventName> =
  '*' | ScopesBySource[EventSource<E> & keyof ScopesBySource];

/** An event name, heard in the nearest scope of its source, or an explicit `{ scope, event }`. */
export type NxaEventSelector<E extends NxaEventName> = E | { scope: NxaEventScope<E>; event: E };

export type NxaEventCallback<E extends NxaEventName> = (payload: NxaEvents[E]) => void;

export interface InjectNxaEventOptions {
  /** Injector that resolves the scope and whose `DestroyRef` ends the subscription. Required outside an injection context. */
  injector?: Injector;
}

/** A live event subscription. */
export interface NxaEventRef {
  /** Stops the delivery before the injector is destroyed. Calling it again does nothing. */
  destroy(): void;
}

const THREAD_SCOPES = ['thread', 'threads', '*'] as const;
const COMPOSER_SCOPES = ['composer', 'message', 'thread', 'threads', '*'] as const;

// The scopes each event can be heard in. It is also the list of known events.
const SCOPES: { readonly [E in NxaEventName]: readonly NxaEventScope<E>[] } = {
  'thread.runStart': THREAD_SCOPES,
  'thread.runEnd': THREAD_SCOPES,
  'thread.initialize': THREAD_SCOPES,
  'thread.modelContextUpdate': THREAD_SCOPES,
  'thread.historyWriteError': THREAD_SCOPES,
  'thread.toolApprovalAnswered': THREAD_SCOPES,
  'composer.send': COMPOSER_SCOPES,
  'composer.attachmentAdd': COMPOSER_SCOPES,
  'composer.attachmentAddError': COMPOSER_SCOPES,
  'message.error': ['message', 'thread', 'threads', '*'],
  'threads.selectionChanged': ['threads', '*'],
};

const THREAD_EVENTS = {
  'thread.runStart': 'runStart',
  'thread.runEnd': 'runEnd',
  'thread.initialize': 'initialize',
  'thread.modelContextUpdate': 'modelContextUpdate',
  'thread.historyWriteError': 'historyWriteError',
  'thread.toolApprovalAnswered': 'toolApprovalAnswered',
} as const;

const COMPOSER_EVENTS = {
  'composer.send': 'send',
  'composer.attachmentAdd': 'attachmentAdd',
  'composer.attachmentAddError': 'attachmentAddError',
} as const;

// Thread lists report these for the threads that are not the main one.
const LIFECYCLE_EVENTS = new Set<string>([
  'runStart',
  'runEnd',
  'initialize',
  'modelContextUpdate',
]);

type Emit = (payload: object) => void;

const all =
  (...unsubscribes: Unsubscribe[]): Unsubscribe =>
  () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };

/**
 * Calls `callback` whenever the selected event fires, until the surrounding injector is
 * destroyed or the returned ref is destroyed.
 *
 * A plain event name is heard in the nearest scope of its source: `'composer.attachmentAdd'`
 * inside a message scope hears only that message's edit composer. `{ scope, event }` widens it to
 * a scope that contains the source, such as every composer of the thread, or to `'*'` for the
 * whole assistant. A missing scope throws, like `injectThread()`.
 *
 * Delivery happens on a microtask, after the runtime has finished notifying, so the callback
 * reads the updated state and can write signals. A callback that throws or rejects is reported to
 * Angular's `ErrorHandler`.
 *
 * @example
 * ```ts
 * injectNxaEvent('composer.send', ({ chars }) => analytics.track('send', { chars }));
 * injectNxaEvent({ scope: 'thread', event: 'message.error' }, ({ messageId }) => toast(messageId));
 * ```
 */
export function injectNxaEvent<E extends NxaEventName>(
  selector: NxaEventSelector<E>,
  callback: NxaEventCallback<E>,
  options?: InjectNxaEventOptions,
): NxaEventRef {
  if (!options?.injector) assertInInjectionContext(injectNxaEvent);
  const injector = options?.injector ?? inject(Injector);
  const { scope, event } =
    typeof selector === 'string' ? { scope: selector.split('.')[0]!, event: selector } : selector;

  if (!Object.hasOwn(SCOPES, event)) {
    throw new Error(`[ngx-assistant] Unknown event "${event}".`);
  }
  if (!(SCOPES[event] as readonly string[]).includes(scope)) {
    throw new Error(`[ngx-assistant] Event "${event}" cannot be heard in the "${scope}" scope.`);
  }

  const errorHandler = injector.get(ErrorHandler);
  let active = true;
  const report = (error: unknown) => errorHandler.handleError(error);
  const emit: Emit = (payload) =>
    queueMicrotask(() => {
      if (!active) return;
      try {
        const result: unknown = (callback as (payload: object) => unknown)(payload);
        if (typeof (result as PromiseLike<unknown> | undefined)?.then === 'function') {
          (result as PromiseLike<unknown>).then(undefined, report);
        }
      } catch (error) {
        report(error);
      }
    });

  // The cleanup is registered before subscribing: an injector that is already destroyed throws
  // here, before anything could leak.
  let unbind: Unsubscribe | undefined;
  const stop = () => {
    if (!active) return;
    active = false;
    unbind?.();
  };
  const removeOnDestroy = injector.get(DestroyRef).onDestroy(stop);
  try {
    unbind = runInInjectionContext(injector, () => bind(event, scope, emit));
  } catch (error) {
    removeOnDestroy();
    active = false;
    throw error;
  }
  return {
    destroy: () => {
      if (!active) return;
      removeOnDestroy();
      stop();
    },
  };
}

function bind(event: string, scope: string, emit: Emit): Unsubscribe {
  if (Object.hasOwn(THREAD_EVENTS, event)) {
    const type = THREAD_EVENTS[event as keyof typeof THREAD_EVENTS];
    if (scope === 'thread') return bindThread(injectThread(), type, emit);
    const assistant = injectAssistant();
    const main = bindThread(assistant.thread, type, emit);
    if (!LIFECYCLE_EVENTS.has(type)) return main;
    const others = assistant.threads.unstable_subscribeThreadEvents((e) => {
      if (e.type !== type || e.threadId === assistant.threads.getState().mainThreadId) return;
      emit({ threadId: e.threadId });
    });
    return all(main, others);
  }

  if (Object.hasOwn(COMPOSER_EVENTS, event)) {
    const type = COMPOSER_EVENTS[event as keyof typeof COMPOSER_EVENTS];
    if (scope === 'composer') {
      const composer = injectComposer();
      const thread = injectThread();
      const message = inject(NXA_MESSAGE, { optional: true });
      return bindComposer(composer, thread, editedMessageId(composer, message, thread), type, emit);
    }
    if (scope === 'message') {
      const message = injectMessage();
      return bindComposer(
        message.composer,
        injectThread(),
        () => message.getState().id,
        type,
        emit,
      );
    }
    const thread = scope === 'thread' ? injectThread() : injectAssistant().thread;
    return bindThreadComposers(thread, type, emit);
  }

  if (event === 'message.error') {
    if (scope === 'message') return bindMessageError(injectMessage(), injectThread(), emit);
    const thread = scope === 'thread' ? injectThread() : injectAssistant().thread;
    return bindThreadMessageErrors(thread, emit);
  }

  return bindSelection(injectAssistant().threads, emit);
}

const threadIdOf = (thread: ThreadRuntime) => thread.getState().threadId;

function bindThread(thread: ThreadRuntime, type: string, emit: Emit): Unsubscribe {
  switch (type) {
    case 'historyWriteError':
      return thread.unstable_on('historyWriteError', ({ operation, messageIds, message }) =>
        emit({ threadId: threadIdOf(thread), operation, messageIds, message }),
      );
    case 'toolApprovalAnswered':
      return thread.unstable_on('toolApprovalAnswered', (payload) =>
        emit({ threadId: threadIdOf(thread), ...payload }),
      );
    default:
      return thread.unstable_on(
        type as 'runStart' | 'runEnd' | 'initialize' | 'modelContextUpdate',
        () => emit({ threadId: threadIdOf(thread) }),
      );
  }
}

// The message an edit composer belongs to: the message scope that provides it, or its path.
function editedMessageId(
  composer: ComposerRuntime,
  message: MessageRuntime | null,
  thread: ThreadRuntime,
): (() => string | undefined) | undefined {
  if (composer.type !== 'edit') return undefined;
  if (message?.composer === composer) return () => message.getState().id;
  const { path } = composer;
  if (path.composerSource !== 'edit') return undefined;
  const selector = path.messageSelector;
  if (selector.type === 'messageId') return () => selector.messageId;
  return () => thread.getState().messages[selector.index]?.id;
}

function bindComposer(
  composer: ComposerRuntime,
  thread: ThreadRuntime,
  messageId: (() => string | undefined) | undefined,
  type: string,
  emit: Emit,
): Unsubscribe {
  const context = () => {
    const id = messageId?.();
    return { threadId: threadIdOf(thread), ...(id !== undefined && { messageId: id }) };
  };
  switch (type) {
    case 'send':
      return composer.unstable_on('send', ({ chars, attachments }) =>
        emit({ ...context(), chars, attachments }),
      );
    case 'attachmentAdd':
      return composer.unstable_on('attachmentAdd', ({ contentType }) =>
        emit({ ...context(), ...(contentType && { contentType }) }),
      );
    default:
      // The raw `error` stays on the runtime event: the payload carries only its message.
      return composer.unstable_on(
        'attachmentAddError',
        ({ attachmentId, reason, message, contentType }) =>
          emit({
            ...context(),
            ...(attachmentId && { attachmentId }),
            reason,
            message,
            ...(contentType && { contentType }),
          }),
      );
  }
}

// The thread composer plus the edit composer of every message, followed by id as messages come
// and go.
function bindThreadComposers(thread: ThreadRuntime, type: string, emit: Emit): Unsubscribe {
  const own = bindComposer(thread.composer, thread, undefined, type, emit);
  const edits = new Map<string, Unsubscribe>();
  const sync = () => {
    const ids = new Set(thread.getState().messages.map((m) => m.id));
    for (const [id, unsubscribe] of edits) {
      if (ids.has(id)) continue;
      edits.delete(id);
      unsubscribe();
    }
    for (const id of ids) {
      if (edits.has(id)) continue;
      const composer = thread.getMessageById(id).composer;
      edits.set(
        id,
        bindComposer(composer, thread, () => id, type, emit),
      );
    }
  };
  sync();
  const unsubscribe = thread.subscribe(sync);
  return () => {
    unsubscribe();
    own();
    for (const off of edits.values()) off();
    edits.clear();
  };
}

const isError = (status: MessageStatus | undefined) =>
  status?.type === 'incomplete' && status.reason === 'error';

// Fires on the transition into the error status. A runtime taken by index can start pointing at
// another message: that message's status is a new baseline, not a transition.
function bindMessageError(message: MessageRuntime, thread: ThreadRuntime, emit: Emit): Unsubscribe {
  const read = () => {
    try {
      const { id, status } = message.getState();
      return { id, error: isError(status) };
    } catch {
      return undefined; // the message is gone
    }
  };
  let last = read();
  return message.subscribe(() => {
    const next = read();
    if (next && last && next.id === last.id && next.error && !last.error) {
      emit({ threadId: threadIdOf(thread), messageId: next.id, reason: 'error' });
    }
    last = next;
  });
}

function bindThreadMessageErrors(thread: ThreadRuntime, emit: Emit): Unsubscribe {
  const read = () =>
    new Map(thread.getState().messages.map((m) => [m.id, isError(m.status)] as const));
  let last = read();
  return thread.subscribe(() => {
    const next = read();
    for (const [id, error] of next) {
      if (error && last.get(id) === false) {
        emit({ threadId: threadIdOf(thread), messageId: id, reason: 'error' });
      }
    }
    last = next;
  });
}

function bindSelection(threads: ThreadListRuntime, emit: Emit): Unsubscribe {
  let previous = threads.getState().mainThreadId;
  return threads.subscribe(() => {
    const threadId = threads.getState().mainThreadId;
    if (threadId === previous) return;
    emit({ threadId, previousThreadId: previous });
    previous = threadId;
  });
}
