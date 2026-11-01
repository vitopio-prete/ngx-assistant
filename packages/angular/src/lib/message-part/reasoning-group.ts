import {
  DestroyRef,
  Directive,
  EmbeddedViewRef,
  Signal,
  TemplateRef,
  ViewContainerRef,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  signal,
  untracked,
} from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectMessage, injectPart } from '../scopes';
import { createScrollLock } from './scroll-lock';

/** A run of consecutive reasoning parts, as `*nxaReasoningGroup` gives it to its template. */
export interface NxaReasoningGroupRef {
  /** The index of the first part of the run. */
  readonly startIndex: Signal<number>;
  /** The index of the last part of the run. */
  readonly endIndex: Signal<number>;
  /** The indices of the parts of the run, for `*nxaMessagePartByIndex`. */
  readonly indices: Signal<readonly number[]>;
  /** Whether the model is still writing one of the parts. */
  readonly streaming: Signal<boolean>;
  /**
   * Whether the group is open: it follows `streaming` (open while the model reasons, closed after)
   * until `setOpen` or `toggle` is called, and then keeps the user's choice.
   */
  readonly open: Signal<boolean>;
  setOpen(open: boolean): void;
  toggle(): void;
}

/** The template context of `*nxaReasoningGroup`: `let group` is the {@link NxaReasoningGroupRef}. */
export interface NxaReasoningGroupContext {
  $implicit: NxaReasoningGroupRef;
}

/**
 * Inside the row of a reasoning part, renders its template once for each run of consecutive
 * reasoning parts: on the first part of the run, and nothing on the others. The template gets the
 * run as `let group` (see {@link NxaReasoningGroupRef}) and renders its parts with
 * `*nxaMessagePartByIndex`.
 *
 * Every change of `open`, by the user or by the end of the stream, first locks the scroll of the
 * nearest scrollable ancestor for `lockMs` milliseconds (default 200), the time of a collapse
 * animation, so that the thread does not jump while the group changes height.
 *
 * @example
 * ```html
 * <ng-container *nxaMessageParts="let part">
 *   @if (part().type === 'reasoning') {
 *     <div *nxaReasoningGroup="let group" [attr.data-state]="group.open() ? 'open' : 'closed'">
 *       <button type="button" (click)="group.toggle()" [attr.aria-expanded]="group.open()">
 *         Reasoning
 *       </button>
 *       @if (group.open()) {
 *         @for (index of group.indices(); track index) {
 *           <p *nxaMessagePartByIndex="index" nxaMessagePartText></p>
 *         }
 *       }
 *     </div>
 *   }
 * </ng-container>
 * ```
 */
@Directive({ selector: '[nxaReasoningGroup]' })
export class NxaReasoningGroup {
  readonly nxaReasoningGroupLockMs = input(200, { transform: numberAttribute });

  // Types the template context; `ctx` is only used in the type predicate.
  static ngTemplateContextGuard(
    _dir: NxaReasoningGroup,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ctx: unknown,
  ): ctx is NxaReasoningGroupContext {
    return true;
  }

  constructor() {
    const part = injectPart();
    const message = injectMessage();
    const messageState = fromRuntime(message);
    // Reasoning parts are bound to their position; a part followed by a tool call id is not one.
    const selector = part.path.messagePartSelector;
    const index = signal(selector.type === 'index' ? selector.index : -1).asReadonly();

    const isFirst = computed(() => {
      const content = messageState().content;
      const i = index();
      return i >= 0 && content[i]?.type === 'reasoning' && content[i - 1]?.type !== 'reasoning';
    });
    // A part that does not start a run renders nothing and owns no parts.
    const endIndex = computed(() => {
      if (!isFirst()) return index();
      const content = messageState().content;
      let last = index();
      while (content[last + 1]?.type === 'reasoning') last++;
      return last;
    });
    const indices = computed(() =>
      isFirst()
        ? Array.from({ length: endIndex() - index() + 1 }, (_, offset) => index() + offset)
        : [],
    );
    const streaming = computed(() => {
      const s = messageState();
      if (!isFirst() || s.status?.type !== 'running') return false;
      const content = s.content;
      // As the engine sets part statuses: the part's own stream status while the message runs,
      // otherwise running only for the last part.
      return indices().some((i) => {
        const own = (content[i] as { status?: { type?: unknown } }).status?.type;
        if (own === 'running' || own === 'complete' || own === 'incomplete') {
          return own === 'running';
        }
        return i === content.length - 1;
      });
    });

    const container = inject(ViewContainerRef);
    const { lock, dispose } = createScrollLock(
      () => container.element.nativeElement.parentElement,
      () => this.nxaReasoningGroupLockMs(),
    );
    const userOpen = signal<boolean | null>(null);
    const open = computed(() => userOpen() ?? streaming());
    const setOpen = (value: boolean) => {
      lock();
      userOpen.set(value);
    };

    const group: NxaReasoningGroupRef = {
      startIndex: index,
      endIndex,
      indices,
      streaming,
      open,
      setOpen,
      toggle: () => setOpen(!untracked(open)),
    };

    // The end of the stream closes a group the user left alone.
    let wasStreaming: boolean | undefined;
    effect(() => {
      const value = streaming();
      if (
        wasStreaming !== undefined &&
        value !== wasStreaming &&
        untracked(isFirst) &&
        untracked(userOpen) === null
      ) {
        lock();
      }
      wasStreaming = value;
    });

    const template = inject(TemplateRef<NxaReasoningGroupContext>);
    let view: EmbeddedViewRef<NxaReasoningGroupContext> | null = null;
    effect(() => {
      const show = isFirst();
      untracked(() => {
        if (show && !view) view = container.createEmbeddedView(template, { $implicit: group });
        else if (!show && view) {
          container.clear();
          view = null;
        }
      });
    });
    inject(DestroyRef).onDestroy(dispose);
  }
}
