import {
  DestroyRef,
  Directive,
  Injector,
  TemplateRef,
  Type,
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
import { NXA_TOOL_UI_REGISTRY } from '../tools/tool-ui-registry';
import { KeyedViews, type KeyedRow, type NxaRowContext } from './keyed-views';

/** The template context of `*nxaMessageParts`: `let part` is a `Signal` of the part state. */
export type NxaMessagePartsContext = NxaRowContext<MessagePartState>;

// A row rendered by a component is keyed by it too, so a change of UI creates the row again.
const componentIds = new WeakMap<Type<unknown>, number>();
let nextComponentId = 0;
const componentKey = (component: Type<unknown>) => {
  let id = componentIds.get(component);
  if (id === undefined) componentIds.set(component, (id = nextComponentId++));
  return `#ui${id}`;
};

/**
 * Renders its template once per content part of the nearest message. Each row is a part scope:
 * inside it `injectPart()` is the row's part, with its `status`.
 *
 * A tool call whose `toolCallId` is unique in the message follows it, so its row and the state
 * inside it move with the call when the parts are reordered. Any other part is bound to its
 * position: when the part at a position changes type, its row is created again. The context gives
 * `let part` (a `Signal` of the part state), `index`, `count`, `first` and `last`.
 *
 * A `tool-call` part whose tool has a UI in the nearest tool UI registry (`provideToolUi(...)`,
 * by name, then the fallback) is rendered by that component instead of the template; the
 * component reads its call with `injectToolCall()`. When the registered UI changes, the row is
 * created again with the new one, or with the template once no UI is left.
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
  private readonly registry = inject(NXA_TOOL_UI_REGISTRY, { optional: true });

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
          // Read in the effect, so a registration made or removed later updates the row.
          const component =
            part.type === 'tool-call'
              ? (this.registry?.resolve(part.toolName) ?? undefined)
              : undefined;
          const suffix = component ? componentKey(component) : '';
          // The engine keys a tool call by its id only while the id is unique in the message.
          if (part.type === 'tool-call' && key === `tool-call:${part.toolCallId}`) {
            return {
              key: key + suffix,
              create: () => message.getMessagePartByToolCallId(part.toolCallId),
              component,
            };
          }
          return {
            key: `${part.type}@${index}${suffix}`,
            create: () => message.getMessagePartByIndex(index),
            component,
          };
        }),
      );
    });
    inject(DestroyRef).onDestroy(() => views.clear());
  }
}
