import {
  DestroyRef,
  Directive,
  ElementRef,
  ErrorHandler,
  InjectionToken,
  Signal,
  afterNextRender,
  afterRenderEffect,
  booleanAttribute,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { injectNxaEvent } from '../events';
import { fromRuntime } from '../from-runtime';
import { injectAssistant, injectThread } from '../scopes';
import { createThreadViewportAutoScroll } from './viewport-auto-scroll';

/** A height a footer adds to the viewport's content inset, while it is registered. */
export interface NxaContentInset {
  setHeight(height: number): void;
  unregister(): void;
}

/** The scroll channel a thread viewport offers to the elements inside it. */
export interface NxaThreadViewportRef {
  /** Whether the viewport sits at the bottom, a footer's inset included. */
  readonly isAtBottom: Signal<boolean>;
  /** Scrolls to the bottom and follows the content again. Notifies `onScrollToBottom` listeners. */
  scrollToBottom(behavior?: ScrollBehavior): void;
  /** Registers a height covering the bottom of the content. Several registrations sum. */
  registerContentInset(): NxaContentInset;
  /** Calls `callback` on every `scrollToBottom()`. Returns the function that removes it. */
  onScrollToBottom(callback: (behavior: ScrollBehavior) => void): () => void;
}

/** The nearest thread viewport, provided by `nxaThreadViewport`. */
export const NXA_THREAD_VIEWPORT = new InjectionToken<NxaThreadViewportRef>('NXA_THREAD_VIEWPORT');

/**
 * The scrollable container of a thread. It keeps the thread pinned to the bottom: content growth
 * scrolls back down while the reader sits at the bottom, and scrolling up unpins until the reader
 * returns there. Older messages prepended above keep the rows the reader is looking at in place.
 *
 * - `autoScroll` follows content growth; the other options gate the scroll when the first
 *   messages appear, when a run starts and when the thread list switches threads.
 * - A wheel, touch, pointer or scroll key cancels a scroll still in flight. Opening a collapsed
 *   disclosure inside a message pauses the follow until the reader scrolls back to the bottom.
 * - Messages are found by their `data-nxa-message-id` attribute.
 * - `data-nxa-at-bottom` is present while the viewport sits at the bottom.
 *
 * Provides `NXA_THREAD_VIEWPORT` to its content, which `nxaScrollToBottom` and
 * `nxaThreadViewportFooter` use. The element needs a fixed height and `overflow-y: auto`.
 *
 * @example
 * ```html
 * <div nxaThreadViewport class="viewport">
 *   ...messages...
 *   <div nxaThreadViewportFooter class="sticky bottom-0">
 *     <button nxaScrollToBottom>Scroll to bottom</button>
 *   </div>
 * </div>
 * ```
 */
@Directive({
  selector: '[nxaThreadViewport]',
  exportAs: 'nxaThreadViewport',
  providers: [{ provide: NXA_THREAD_VIEWPORT, useExisting: NxaThreadViewport }],
  host: { '[attr.data-nxa-at-bottom]': "isAtBottom() ? '' : null" },
})
export class NxaThreadViewport implements NxaThreadViewportRef {
  /** Whether content growth keeps the viewport at the bottom while it is pinned there. */
  readonly autoScroll = input(true, { transform: booleanAttribute });
  /** Whether the viewport scrolls to the bottom once the thread has messages. */
  readonly scrollToBottomOnInitialize = input(true, { transform: booleanAttribute });
  /** Whether the viewport scrolls to the bottom when a run starts. */
  readonly scrollToBottomOnRunStart = input(true, { transform: booleanAttribute });
  /** Whether the viewport scrolls to the bottom when the thread list switches threads. */
  readonly scrollToBottomOnThreadSwitch = input(true, { transform: booleanAttribute });

  private readonly atBottom = signal(true);
  readonly isAtBottom = this.atBottom.asReadonly();

  private readonly element: HTMLElement = inject(ElementRef).nativeElement;
  private readonly thread = injectThread();
  private readonly errorHandler = inject(ErrorHandler);
  private readonly listeners = new Set<(behavior: ScrollBehavior) => void>();
  private readonly controller = createThreadViewportAutoScroll({
    getOptions: () => ({
      autoScroll: this.autoScroll(),
      scrollToBottomOnInitialize: this.scrollToBottomOnInitialize(),
      scrollToBottomOnRunStart: this.scrollToBottomOnRunStart(),
      scrollToBottomOnThreadSwitch: this.scrollToBottomOnThreadSwitch(),
    }),
    onAtBottomChange: (value) => this.atBottom.set(value),
  });

  constructor() {
    const hasMessages = fromRuntime(this.thread, (s) => s.messages.length > 0);
    const threadId = fromRuntime(this.thread, (s) => s.threadId);
    const firstMessageId = fromRuntime(this.thread, (s) => s.messages[0]?.id);

    // Attached after the first render, so it never runs on the server.
    afterNextRender(() => this.controller.attach(this.element));
    inject(DestroyRef).onDestroy(() => {
      this.controller.dispose();
      this.listeners.clear();
    });

    afterRenderEffect(() => {
      // Read so that turning the option on seeds the scroll, as a new message would.
      this.scrollToBottomOnInitialize();
      const has = hasMessages();
      // The controller reads the other options too; they must not rerun this effect.
      untracked(() => this.controller.setHasMessages(has));
    });

    // Runs after the rendered rows match the messages, so the anchor can be measured.
    let previous: { threadId: string; firstMessageId: string | undefined } | undefined;
    afterRenderEffect(() => {
      const current = { threadId: threadId(), firstMessageId: firstMessageId() };
      const last = previous;
      previous = current;
      if (!last || last.threadId !== current.threadId) return;
      const previousFirst = last.firstMessageId;
      if (previousFirst === undefined || previousFirst === current.firstMessageId) return;
      untracked(() => {
        const prepended = this.thread
          .getState()
          .messages.some((message, index) => index > 0 && message.id === previousFirst);
        if (prepended) this.controller.messagesPrepended(previousFirst);
      });
    });

    injectNxaEvent('thread.runStart', () => this.controller.runStarted());
    if (injectAssistant({ optional: true })) {
      injectNxaEvent('threads.selectionChanged', () => this.controller.threadSwitched());
    }
  }

  scrollToBottom(behavior: ScrollBehavior = 'auto') {
    this.controller.scrollToBottom(behavior);
    for (const listener of [...this.listeners]) {
      try {
        listener(behavior);
      } catch (error) {
        this.errorHandler.handleError(error);
      }
    }
  }

  registerContentInset(): NxaContentInset {
    return this.controller.registerContentInset();
  }

  onScrollToBottom(callback: (behavior: ScrollBehavior) => void) {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
}
