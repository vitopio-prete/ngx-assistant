import {
  Directive,
  EmbeddedViewRef,
  Signal,
  TemplateRef,
  ViewContainerRef,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import type { MessageState, MessageStatus } from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';
import { injectMessage } from '../scopes';

/** The error of a message: its text, or the value the runtime reported. */
export type MessageErrorValue = NonNullable<
  Extract<MessageStatus, { type: 'incomplete' }>['error']
>;

/**
 * The error of a message that ended with `incomplete` / `error`, or `undefined` for any other
 * status. A string is returned as is, an object with a string `message` gives that message, any
 * other value is returned as is, and a missing value gives `'An error occurred'`.
 */
export function getMessageErrorText(
  message: Pick<MessageState, 'status'>,
): MessageErrorValue | undefined {
  const status = message.status;
  if (status?.type !== 'incomplete' || status.reason !== 'error') return undefined;
  const error = status.error;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const text = error['message'];
    if (typeof text === 'string') return text;
  }
  return error ?? 'An error occurred';
}

/** The template context of `*nxaMessageError`: `let error` is a `Signal` of the error. */
export interface NxaMessageErrorContext {
  $implicit: Signal<MessageErrorValue>;
}

/**
 * Renders its template while the nearest message ended with an error, for instance when its run
 * failed; it goes away when the message is run again. `let error` is a `Signal` of the error (see
 * `getMessageErrorText`), so a non-string error can be formatted by the template.
 *
 * @example
 * ```html
 * <div *nxaMessageError="let error" nxaErrorRoot>{{ error() }}</div>
 * ```
 */
@Directive({ selector: '[nxaMessageError]' })
export class NxaMessageError {
  // Types the template context; `ctx` is only used in the type predicate.
  static ngTemplateContextGuard(
    _dir: NxaMessageError,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ctx: unknown,
  ): ctx is NxaMessageErrorContext {
    return true;
  }

  private readonly error = fromRuntime(injectMessage(), getMessageErrorText);

  constructor() {
    const container = inject(ViewContainerRef);
    const template = inject(TemplateRef<NxaMessageErrorContext>);
    const error = computed(() => this.error()!);
    const hasError = computed(() => this.error() !== undefined);
    let view: EmbeddedViewRef<NxaMessageErrorContext> | undefined;
    effect(() => {
      const show = hasError();
      untracked(() => {
        if (show && !view) view = container.createEmbeddedView(template, { $implicit: error });
        if (!show && view) {
          container.clear();
          view = undefined;
        }
      });
    });
  }
}
