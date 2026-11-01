import { DestroyRef, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import type { MessagePartState, MessagePartStatus } from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';
import { injectPart } from '../scopes';

/** Tuning of the smooth reveal of a streamed text. */
export interface NxaSmoothOptions {
  /**
   * The time, in milliseconds, in which the characters not shown yet are revealed. Larger values
   * reveal a long backlog more gradually. Default 250.
   */
  drainMs?: number;
  /** The longest time, in milliseconds, between two revealed characters. Default 5. */
  maxCharIntervalMs?: number;
  /** The most characters revealed in one animation frame. Default unlimited. */
  maxCharsPerFrame?: number;
  /**
   * The shortest time, in milliseconds, between two updates of the shown text. The reveal goes on
   * every frame, but the text (and whatever renders it, such as markdown) changes at most once per
   * interval; the last frame always updates it. Default 0, every frame.
   */
  minCommitMs?: number;
}

/** Whether to reveal a streamed text smoothly: `true`, `false`, or `true` with tuning. */
export type NxaSmooth = boolean | NxaSmoothOptions | null | undefined;

/** The text of a part as shown, and its status. */
export interface NxaSmoothTextState {
  /** The text shown so far. */
  readonly text: string;
  /**
   * `running` until the text is shown in full, then the status of the part.
   */
  readonly status: MessagePartStatus;
}

const DEFAULT_DRAIN_MS = 250;
const DEFAULT_MAX_CHAR_INTERVAL_MS = 5;
const RUNNING: MessagePartStatus = Object.freeze({ type: 'running' });
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const positiveOr = (value: number | undefined, fallback: number) =>
  value !== undefined && value > 0 ? value : fallback;

/** Reveals `targetText` a few characters per animation frame, faster when more are behind. */
export class TextStreamAnimator {
  private frame: number | null = null;
  private lastUpdateTime = 0;
  lastCommitTime = -Infinity;

  targetText = '';
  drainMs = DEFAULT_DRAIN_MS;
  maxCharIntervalMs = DEFAULT_MAX_CHAR_INTERVAL_MS;
  maxCharsPerFrame = Infinity;
  minCommitMs = 0;

  constructor(
    public currentText: string,
    private readonly setText: (text: string) => void,
  ) {}

  start() {
    if (this.frame !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      // No frames to animate with, as on a server: show it all.
      this.currentText = this.targetText;
      this.setText(this.currentText);
      return;
    }
    this.lastUpdateTime = performance.now();
    this.animate();
  }

  stop() {
    if (this.frame === null) return;
    cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private readonly animate = () => {
    const now = performance.now();
    let timeToConsume = now - this.lastUpdateTime;

    const remaining = this.targetText.length - this.currentText.length;
    const timePerChar = Math.min(this.maxCharIntervalMs, this.drainMs / remaining);

    const frameLimit = Math.min(remaining, this.maxCharsPerFrame);
    let charsToAdd = 0;
    while (timeToConsume >= timePerChar && charsToAdd < frameLimit) {
      charsToAdd++;
      timeToConsume -= timePerChar;
    }
    // A frame held back by the cap does not bank its spare time, or the next would burst past it.
    if (charsToAdd === frameLimit && frameLimit === this.maxCharsPerFrame) timeToConsume = 0;

    this.frame = charsToAdd !== remaining ? requestAnimationFrame(this.animate) : null;
    if (charsToAdd === 0) return;

    this.currentText = this.targetText.slice(0, this.currentText.length + charsToAdd);
    this.lastUpdateTime = now - timeToConsume;

    if (charsToAdd === remaining || now - this.lastCommitTime >= this.minCommitMs) {
      this.lastCommitTime = now;
      this.setText(this.currentText);
    }
  };
}

/** Whether the user asked for reduced motion, live; `false` where media queries are unknown. */
function reducedMotion(destroyRef: DestroyRef): Signal<boolean> {
  if (typeof matchMedia !== 'function') return signal(false);
  const query = matchMedia(REDUCED_MOTION);
  const matches = signal(query.matches);
  const onChange = () => matches.set(query.matches);
  query.addEventListener?.('change', onChange);
  destroyRef.onDestroy(() => query.removeEventListener?.('change', onChange));
  return matches.asReadonly();
}

type TextPartState = MessagePartState & {
  readonly type: 'text' | 'reasoning';
  readonly text: string;
};

/**
 * The text of the nearest message part (a `text` or `reasoning` part), revealed a few characters
 * per frame while it streams. `smooth` is read live: `false` shows the text as it is, `true` reveals
 * it at the default rate and an {@link NxaSmoothOptions} object tunes the rate. Under
 * `prefers-reduced-motion: reduce` the text is always shown as it is.
 *
 * While the part runs, the reveal starts from nothing and catches up with the stream; once the part
 * is done, what is left goes on revealing, unless nothing was shown yet, in which case the text
 * appears at once. A text that is no longer a continuation of the shown one (another branch, a
 * reload) starts the reveal again. The status is `running` until the text is shown in full.
 *
 * Call it in an injection context inside a part scope.
 *
 * @example
 * ```ts
 * readonly text = injectSmoothText(() => ({ drainMs: 500 }));
 * ```
 */
export function injectSmoothText(smooth: () => NxaSmooth = () => true): Signal<NxaSmoothTextState> {
  const part = injectPart();
  const type = part.getState().type;
  if (type !== 'text' && type !== 'reasoning') {
    throw new Error(
      `ngx-assistant: the smooth text needs a text or reasoning part, not a ${type} part.`,
    );
  }
  const destroyRef = inject(DestroyRef);
  // A part that stops being text (it should not, its row is created again) reads as empty.
  const state = fromRuntime(part, (s) =>
    typeof (s as Partial<TextPartState>).text === 'string'
      ? (s as TextPartState)
      : ({ ...s, text: '' } as TextPartState),
  );
  const reduced = reducedMotion(destroyRef);

  const settings = computed(() => {
    const value = smooth();
    return {
      enabled: value !== false && value !== null && !reduced(),
      options: typeof value === 'object' && value !== null ? value : undefined,
    };
  });

  const initial = untracked(state);
  const displayed = signal(initial.status.type === 'running' ? '' : initial.text);
  const animator = new TextStreamAnimator(untracked(displayed), (text) => displayed.set(text));

  effect(() => {
    const { enabled, options } = settings();
    const { text, status } = state();
    untracked(() => {
      if (!enabled) {
        // Shown as it is: turning the reveal on again goes on from here, not from the start.
        animator.stop();
        animator.currentText = animator.targetText = text;
        displayed.set(text);
        return;
      }
      animator.drainMs = positiveOr(options?.drainMs, DEFAULT_DRAIN_MS);
      animator.maxCharIntervalMs = positiveOr(
        options?.maxCharIntervalMs,
        DEFAULT_MAX_CHAR_INTERVAL_MS,
      );
      animator.maxCharsPerFrame = positiveOr(options?.maxCharsPerFrame, Infinity);
      animator.minCommitMs = positiveOr(options?.minCommitMs, 0);

      const running = status.type === 'running';
      // Not a continuation of the text so far: start over (running) or show it (settled).
      if (!text.startsWith(animator.targetText) || !text.startsWith(animator.currentText)) {
        animator.stop();
        animator.targetText = text;
        if (running) {
          animator.currentText = '';
          animator.lastCommitTime = -Infinity;
          displayed.set('');
          animator.start();
        } else {
          animator.currentText = text;
          displayed.set(text);
        }
        return;
      }

      animator.targetText = text;
      // Settled before a single character was shown: a frame that never comes would leave the
      // text empty.
      if (!running && animator.currentText === '') {
        animator.stop();
        animator.currentText = text;
        displayed.set(text);
        return;
      }
      if (animator.currentText !== text) animator.start();
    });
  });
  destroyRef.onDestroy(() => animator.stop());

  return computed((): NxaSmoothTextState => {
    const s = state();
    if (!settings().enabled) return { text: s.text, status: s.status };
    let shown = displayed();
    // The shown text is not a prefix any more: until the effect starts over, show where it starts.
    if (!s.text.startsWith(shown)) shown = s.status.type === 'running' ? '' : s.text;
    return { text: shown, status: shown === s.text ? s.status : RUNNING };
  });
}
