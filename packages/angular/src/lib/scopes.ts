import { InjectionToken, Injector, Provider, WritableSignal, inject, signal } from '@angular/core';
import type {
  AssistantRuntime,
  AttachmentRuntime,
  ComposerRuntime,
  MessagePartRuntime,
  MessageRuntime,
  ThreadListItemRuntime,
  ThreadListRuntime,
  ThreadRuntime,
} from '@ngx-assistant/engine';
import { NXA_TOOL_CALL, createToolCall } from './tools/tool-call';
import { TOOL_UI_REGISTRY_PROVIDER } from './tools/tool-ui-registry';

// Each scope is a token in the injector tree. A scope provider sets its own token, derives the
// tokens it implies (a message brings its edit composer) and clears the narrower ones, so a
// lookup never reaches a scope from an unrelated branch of the tree.

export const NXA_ASSISTANT = new InjectionToken<AssistantRuntime | null>('NXA_ASSISTANT');
export const NXA_THREAD = new InjectionToken<ThreadRuntime | null>('NXA_THREAD');
export const NXA_COMPOSER = new InjectionToken<ComposerRuntime | null>('NXA_COMPOSER');
export const NXA_MESSAGE = new InjectionToken<MessageRuntime | null>('NXA_MESSAGE');
export const NXA_PART = new InjectionToken<MessagePartRuntime | null>('NXA_PART');
export const NXA_ATTACHMENT = new InjectionToken<AttachmentRuntime | null>('NXA_ATTACHMENT');
export const NXA_THREAD_LIST = new InjectionToken<ThreadListRuntime | null>('NXA_THREAD_LIST');
export const NXA_THREAD_LIST_ITEM = new InjectionToken<ThreadListItemRuntime | null>(
  'NXA_THREAD_LIST_ITEM',
);

/** One suggestion: what it shows (`title`, `label`) and the text it sends or inserts (`prompt`). */
export interface SuggestionState {
  readonly title: string;
  readonly label: string;
  readonly prompt: string;
}

/** The scope of one suggestion row. A row keeps its suggestion: rows are keyed by its content. */
export interface SuggestionRuntime {
  getState(): SuggestionState;
  subscribe(callback: () => void): () => void;
}

export const NXA_SUGGESTION = new InjectionToken<SuggestionRuntime | null>('NXA_SUGGESTION');

/**
 * View state of one message that the engine does not keep: hover and copy feedback. It belongs to
 * the message scope that provides it, so a nested scope for the same message starts afresh.
 */
export interface MessageUiState {
  /** Whether the pointer is over the message root. */
  readonly isHovering: WritableSignal<boolean>;
  /** Whether the message was just copied, for copy feedback. */
  readonly isCopied: WritableSignal<boolean>;
}

export const NXA_MESSAGE_UI = new InjectionToken<MessageUiState | null>('NXA_MESSAGE_UI');

const cleared = (...tokens: InjectionToken<unknown>[]): Provider[] =>
  tokens.map((provide) => ({ provide, useValue: null }));

/**
 * Provides an assistant scope: `NXA_ASSISTANT`, its thread list, its main thread, the thread
 * composer and a tool UI registry. A nested assistant scope isolates its subtree from the outer
 * one, message, thread list item and suggestion scopes included; its tool UI registry is chained to
 * the one above, so the outer tool UIs still apply.
 */
export function provideAssistantScope(factory: () => AssistantRuntime): Provider[] {
  return [
    { provide: NXA_ASSISTANT, useFactory: factory },
    { provide: NXA_THREAD_LIST, useFactory: () => inject(NXA_ASSISTANT)!.threads },
    { provide: NXA_THREAD, useFactory: () => inject(NXA_ASSISTANT)!.thread },
    { provide: NXA_COMPOSER, useFactory: () => inject(NXA_THREAD)!.composer },
    TOOL_UI_REGISTRY_PROVIDER,
    ...cleared(
      NXA_MESSAGE,
      NXA_MESSAGE_UI,
      NXA_PART,
      NXA_TOOL_CALL,
      NXA_ATTACHMENT,
      NXA_THREAD_LIST_ITEM,
      NXA_SUGGESTION,
    ),
  ];
}

/**
 * Provides a message scope. Inside it, `NXA_COMPOSER` is the message's edit composer;
 * the thread composer stays reachable as `injectThread().composer`. Each scope has its own
 * `NXA_MESSAGE_UI` state.
 */
export function provideMessageScope(factory: () => MessageRuntime): Provider[] {
  return [
    { provide: NXA_MESSAGE, useFactory: factory },
    {
      provide: NXA_MESSAGE_UI,
      useFactory: (): MessageUiState => ({ isHovering: signal(false), isCopied: signal(false) }),
    },
    { provide: NXA_COMPOSER, useFactory: () => inject(NXA_MESSAGE)!.composer },
    ...cleared(NXA_PART, NXA_TOOL_CALL, NXA_ATTACHMENT),
  ];
}

/**
 * Provides a message part scope, under a message scope. A `tool-call` part also provides its
 * `NXA_TOOL_CALL`, live for the lifetime of the scope.
 */
export function providePartScope(factory: () => MessagePartRuntime): Provider[] {
  return [
    { provide: NXA_PART, useFactory: factory },
    {
      provide: NXA_TOOL_CALL,
      useFactory: () => createToolCall(inject(NXA_PART)!, inject(Injector)),
    },
    ...cleared(NXA_ATTACHMENT),
  ];
}

/** Provides an attachment scope, under a composer or a message scope. */
export function provideAttachmentScope(factory: () => AttachmentRuntime): Provider[] {
  return [{ provide: NXA_ATTACHMENT, useFactory: factory }];
}

/** Provides a thread list item scope, under an assistant scope. */
export function provideThreadListItemScope(factory: () => ThreadListItemRuntime): Provider[] {
  return [{ provide: NXA_THREAD_LIST_ITEM, useFactory: factory }];
}

/** Provides a suggestion scope, under an assistant scope. */
export function provideSuggestionScope(factory: () => SuggestionRuntime): Provider[] {
  return [{ provide: NXA_SUGGESTION, useFactory: factory }];
}

export interface InjectScopeOptions {
  /** Return `null` instead of throwing when the scope is not available. */
  optional?: boolean;
}

function injectScope<T>(
  token: InjectionToken<T | null>,
  name: string,
  hint: string,
  options?: InjectScopeOptions,
): T | null {
  const runtime = inject(token, { optional: true }) ?? null;
  if (runtime === null && !options?.optional) {
    throw new Error(`[ngx-assistant] No ${name} scope here: ${hint}`);
  }
  return runtime;
}

const ASSISTANT_HINT =
  'provide a runtime with provideLocalRuntime(...) or provideExternalStoreRuntime(...) on an ancestor.';

/** The nearest assistant runtime. */
export function injectAssistant(
  options: InjectScopeOptions & { optional: true },
): AssistantRuntime | null;
export function injectAssistant(
  options?: InjectScopeOptions & { optional?: false },
): AssistantRuntime;
export function injectAssistant(options: InjectScopeOptions): AssistantRuntime | null;
export function injectAssistant(options?: InjectScopeOptions) {
  return injectScope(NXA_ASSISTANT, 'assistant', ASSISTANT_HINT, options);
}

/** The nearest thread runtime. */
export function injectThread(
  options: InjectScopeOptions & { optional: true },
): ThreadRuntime | null;
export function injectThread(options?: InjectScopeOptions & { optional?: false }): ThreadRuntime;
export function injectThread(options: InjectScopeOptions): ThreadRuntime | null;
export function injectThread(options?: InjectScopeOptions) {
  return injectScope(NXA_THREAD, 'thread', ASSISTANT_HINT, options);
}

/** The nearest composer: the edit composer inside a message scope, otherwise the thread composer. */
export function injectComposer(
  options: InjectScopeOptions & { optional: true },
): ComposerRuntime | null;
export function injectComposer(
  options?: InjectScopeOptions & { optional?: false },
): ComposerRuntime;
export function injectComposer(options: InjectScopeOptions): ComposerRuntime | null;
export function injectComposer(options?: InjectScopeOptions) {
  return injectScope(NXA_COMPOSER, 'composer', ASSISTANT_HINT, options);
}

/** The nearest message runtime. */
export function injectMessage(
  options: InjectScopeOptions & { optional: true },
): MessageRuntime | null;
export function injectMessage(options?: InjectScopeOptions & { optional?: false }): MessageRuntime;
export function injectMessage(options: InjectScopeOptions): MessageRuntime | null;
export function injectMessage(options?: InjectScopeOptions) {
  return injectScope(NXA_MESSAGE, 'message', 'call it inside a message scope.', options);
}

/** The view state of the nearest message. */
export function injectMessageUi(
  options: InjectScopeOptions & { optional: true },
): MessageUiState | null;
export function injectMessageUi(
  options?: InjectScopeOptions & { optional?: false },
): MessageUiState;
export function injectMessageUi(options: InjectScopeOptions): MessageUiState | null;
export function injectMessageUi(options?: InjectScopeOptions) {
  return injectScope(NXA_MESSAGE_UI, 'message', 'call it inside a message scope.', options);
}

/** The nearest message part runtime. */
export function injectPart(
  options: InjectScopeOptions & { optional: true },
): MessagePartRuntime | null;
export function injectPart(options?: InjectScopeOptions & { optional?: false }): MessagePartRuntime;
export function injectPart(options: InjectScopeOptions): MessagePartRuntime | null;
export function injectPart(options?: InjectScopeOptions) {
  return injectScope(NXA_PART, 'message part', 'call it inside a message part scope.', options);
}

/** The nearest attachment runtime. */
export function injectAttachment(
  options: InjectScopeOptions & { optional: true },
): AttachmentRuntime | null;
export function injectAttachment(
  options?: InjectScopeOptions & { optional?: false },
): AttachmentRuntime;
export function injectAttachment(options: InjectScopeOptions): AttachmentRuntime | null;
export function injectAttachment(options?: InjectScopeOptions) {
  return injectScope(NXA_ATTACHMENT, 'attachment', 'call it inside an attachment scope.', options);
}

/** The thread list of the nearest assistant. */
export function injectThreadList(
  options: InjectScopeOptions & { optional: true },
): ThreadListRuntime | null;
export function injectThreadList(
  options?: InjectScopeOptions & { optional?: false },
): ThreadListRuntime;
export function injectThreadList(options: InjectScopeOptions): ThreadListRuntime | null;
export function injectThreadList(options?: InjectScopeOptions) {
  return injectScope(NXA_THREAD_LIST, 'thread list', ASSISTANT_HINT, options);
}

/** The nearest thread list item runtime. */
export function injectThreadListItem(
  options: InjectScopeOptions & { optional: true },
): ThreadListItemRuntime | null;
export function injectThreadListItem(
  options?: InjectScopeOptions & { optional?: false },
): ThreadListItemRuntime;
export function injectThreadListItem(options: InjectScopeOptions): ThreadListItemRuntime | null;
export function injectThreadListItem(options?: InjectScopeOptions) {
  return injectScope(
    NXA_THREAD_LIST_ITEM,
    'thread list item',
    'call it inside a thread list item scope.',
    options,
  );
}

/** The nearest suggestion. */
export function injectSuggestion(
  options: InjectScopeOptions & { optional: true },
): SuggestionRuntime | null;
export function injectSuggestion(
  options?: InjectScopeOptions & { optional?: false },
): SuggestionRuntime;
export function injectSuggestion(options: InjectScopeOptions): SuggestionRuntime | null;
export function injectSuggestion(options?: InjectScopeOptions) {
  return injectScope(NXA_SUGGESTION, 'suggestion', 'call it inside a suggestion scope.', options);
}
