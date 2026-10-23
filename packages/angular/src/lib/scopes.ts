import { InjectionToken, Provider, inject } from '@angular/core';
import type {
  AssistantRuntime,
  AttachmentRuntime,
  ComposerRuntime,
  MessagePartRuntime,
  MessageRuntime,
  ThreadRuntime,
} from '@ngx-assistant/engine';

// Each scope is a token in the injector tree. A scope provider sets its own token, derives the
// tokens it implies (a message brings its edit composer) and clears the narrower ones, so a
// lookup never reaches a scope from an unrelated branch of the tree.

export const NXA_ASSISTANT = new InjectionToken<AssistantRuntime | null>('NXA_ASSISTANT');
export const NXA_THREAD = new InjectionToken<ThreadRuntime | null>('NXA_THREAD');
export const NXA_COMPOSER = new InjectionToken<ComposerRuntime | null>('NXA_COMPOSER');
export const NXA_MESSAGE = new InjectionToken<MessageRuntime | null>('NXA_MESSAGE');
export const NXA_PART = new InjectionToken<MessagePartRuntime | null>('NXA_PART');
export const NXA_ATTACHMENT = new InjectionToken<AttachmentRuntime | null>('NXA_ATTACHMENT');

const cleared = (...tokens: InjectionToken<unknown>[]): Provider[] =>
  tokens.map((provide) => ({ provide, useValue: null }));

/**
 * Provides an assistant scope: `NXA_ASSISTANT`, its main thread and the thread composer.
 * A nested assistant scope isolates its subtree from the outer one, message scopes included.
 */
export function provideAssistantScope(factory: () => AssistantRuntime): Provider[] {
  return [
    { provide: NXA_ASSISTANT, useFactory: factory },
    { provide: NXA_THREAD, useFactory: () => inject(NXA_ASSISTANT)!.thread },
    { provide: NXA_COMPOSER, useFactory: () => inject(NXA_THREAD)!.composer },
    ...cleared(NXA_MESSAGE, NXA_PART, NXA_ATTACHMENT),
  ];
}

/**
 * Provides a message scope. Inside it, `NXA_COMPOSER` is the message's edit composer;
 * the thread composer stays reachable as `injectThread().composer`.
 */
export function provideMessageScope(factory: () => MessageRuntime): Provider[] {
  return [
    { provide: NXA_MESSAGE, useFactory: factory },
    { provide: NXA_COMPOSER, useFactory: () => inject(NXA_MESSAGE)!.composer },
    ...cleared(NXA_PART, NXA_ATTACHMENT),
  ];
}

/** Provides a message part scope, under a message scope. */
export function providePartScope(factory: () => MessagePartRuntime): Provider[] {
  return [{ provide: NXA_PART, useFactory: factory }, ...cleared(NXA_ATTACHMENT)];
}

/** Provides an attachment scope, under a composer or a message scope. */
export function provideAttachmentScope(factory: () => AttachmentRuntime): Provider[] {
  return [{ provide: NXA_ATTACHMENT, useFactory: factory }];
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

const ASSISTANT_HINT = 'provide a runtime with provideLocalRuntime(...) on an ancestor.';

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
