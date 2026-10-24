import {
  DestroyRef,
  Directive,
  Injector,
  TemplateRef,
  ViewContainerRef,
  effect,
  inject,
} from '@angular/core';
import {
  getMessagePartKeys,
  type MessagePartRuntime,
  type MessagePartState,
} from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';
import { injectMessage, providePartScope } from '../scopes';
import { KeyedViews, type KeyedRow, type NxaRowContext } from './keyed-views';

/** The template context of `*nxaMessageParts`: `let part` is a `Signal` of the part state. */
export type NxaMessagePartsContext = NxaRowContext<MessagePartState>;

/**
 * Renders its template once per content part of the nearest message. Each row is a part scope:
 * inside it `injectPart()` is the row's part, with its `status`.
 *
 * A tool call whose `toolCallId` is unique in the message follows it, so its row and the state
 * inside it move with the call when the parts are reordered. Any other part is bound to its
 * position: when the part at a position changes type, its row is created again. The context gives
 * `let part` (a `Signal` of the part state), `index`, `count`, `first` and `last`.
 *
 * @example
 * ```html
 * <ng-container *nxaMessageParts="let part">
 *   @let p = part();
 *   @switch (p.type) {
 *     @case ('text') { <p>{{ p.text }}</p> }
 *     @case ('tool-call') { <app-tool-call /> }
 *   }
 * </ng-container>
 * ```
 */
@Directive({ selector: '[nxaMessageParts]' })
export class NxaMessageParts {
  private readonly message = injectMessage();
  private readonly content = fromRuntime(this.message, (s) => s.content);

  // Types the template context; `ctx` is only used in the type predicate.
  static ngTemplateContextGuard(
    _dir: NxaMessageParts,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ctx: unknown,
  ): ctx is NxaMessagePartsContext {
    return true;
  }

  constructor() {
    const views = new KeyedViews<MessagePartState, MessagePartRuntime>(
      inject(ViewContainerRef),
      inject(TemplateRef<NxaMessagePartsContext>),
      inject(Injector),
      providePartScope,
    );
    effect(() => {
      const message = this.message;
      const content = this.content();
      const keys = getMessagePartKeys(content);
      views.update(
        content.map((part, index): KeyedRow<MessagePartRuntime> => {
          const key = keys[index]!;
          // The engine keys a tool call by its id only while the id is unique in the message.
          if (part.type === 'tool-call' && key === `tool-call:${part.toolCallId}`) {
            return {
              key,
              create: () => message.getMessagePartByToolCallId(part.toolCallId),
            };
          }
          return {
            key: `${part.type}@${index}`,
            create: () => message.getMessagePartByIndex(index),
          };
        }),
      );
    });
    inject(DestroyRef).onDestroy(() => views.clear());
  }
}
