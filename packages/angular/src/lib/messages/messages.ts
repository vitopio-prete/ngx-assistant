import {
  DestroyRef,
  Directive,
  Injector,
  TemplateRef,
  ViewContainerRef,
  effect,
  inject,
} from '@angular/core';
import type { MessageRuntime, MessageState } from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';
import { injectThread, provideMessageScope } from '../scopes';
import { KeyedViews, type NxaRowContext } from './keyed-views';

/** The template context of `*nxaMessages`: `let message` is a `Signal` of the message state. */
export type NxaMessagesContext = NxaRowContext<MessageState>;

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Renders its template once per message of the nearest thread. Each row is a message scope:
 * inside it `injectMessage()` is the row's message and `injectComposer()` its edit composer.
 *
 * Rows follow the message id. A message updated in place keeps its row, and the row keeps its
 * state, when messages before it are added or removed; a new id creates a new row. The context
 * gives `let message` (a `Signal` of the message state), `index`, `count`, `first` and `last`.
 *
 * @example
 * ```html
 * <div *nxaMessages="let message" nxaMessageRoot>
 *   {{ message().role }}
 * </div>
 * ```
 */
@Directive({ selector: '[nxaMessages]' })
export class NxaMessages {
  private readonly thread = injectThread();
  private readonly ids = fromRuntime(this.thread, (s) => s.messages.map((m) => m.id), {
    equal: sameIds,
  });

  // Types the template context; `ctx` is only used in the type predicate.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static ngTemplateContextGuard(_dir: NxaMessages, ctx: unknown): ctx is NxaMessagesContext {
    return true;
  }

  constructor() {
    const views = new KeyedViews<MessageState, MessageRuntime>(
      inject(ViewContainerRef),
      inject(TemplateRef<NxaMessagesContext>),
      inject(Injector),
      provideMessageScope,
    );
    effect(() => {
      const thread = this.thread;
      views.update(this.ids().map((id) => ({ key: id, create: () => thread.getMessageById(id) })));
    });
    inject(DestroyRef).onDestroy(() => views.clear());
  }
}
