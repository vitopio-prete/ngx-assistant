import { Directive, booleanAttribute, computed, input } from '@angular/core';
import type { ThreadState } from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';
import { injectComposer, injectSuggestion, injectThread } from '../scopes';

/**
 * How a suggestion can be sent now: at once, queued behind the run in flight, or not at all (sends
 * are disabled, the run cannot queue, or a voice session does not take typed text).
 */
export function suggestionSendMode(thread: ThreadState): 'now' | 'queued' | 'blocked' {
  if (thread.isSendDisabled) return 'blocked';
  if (thread.voice !== undefined) return thread.voice.canSendText ? 'now' : 'blocked';
  if (!thread.isRunning) return 'now';
  return thread.capabilities.queue ? 'queued' : 'blocked';
}

/**
 * A button that uses the nearest suggestion.
 *
 * With `send`, the prompt is appended to the thread as a message with the composer's run config,
 * and the composer is cleared (`clearComposer`, on by default). A send queued behind a run never
 * clears the composer, so a draft the user is writing survives. The button is disabled while the
 * suggestion could not be sent, and the send policy is checked again on click.
 *
 * Without `send`, the prompt replaces the composer text, or is added after it with a space when
 * `clearComposer` is false; this works during a run too.
 *
 * The button is disabled while the thread is disabled. A capture-phase `click` listener can veto
 * it with `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaSuggestionTrigger send><span nxaSuggestionTitle></span></button>
 * ```
 */
@Directive({
  selector: 'button[nxaSuggestionTrigger]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaSuggestionTrigger {
  /** Sends the prompt as a message instead of putting it in the composer. */
  readonly send = input(false, { transform: booleanAttribute });
  /** Clears the composer after a send, or replaces its text instead of adding to it. */
  readonly clearComposer = input(true, { transform: booleanAttribute });
  /** Disables the button on top of the thread state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly suggestion = injectSuggestion();
  private readonly thread = injectThread();
  private readonly composer = injectComposer();
  private readonly threadDisabled = fromRuntime(this.thread, (s) => s.isDisabled);
  private readonly sendBlocked = fromRuntime(
    this.thread,
    (s) => suggestionSendMode(s) === 'blocked',
  );
  protected readonly isDisabled = computed(
    () => this.disabled() || this.threadDisabled() || (this.send() && this.sendBlocked()),
  );

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    const prompt = this.suggestion.getState().prompt;
    if (this.send()) {
      const mode = suggestionSendMode(this.thread.getState());
      if (mode === 'blocked') return;
      this.thread.append({
        content: [{ type: 'text', text: prompt }],
        runConfig: this.composer.getState().runConfig,
      });
      if (this.clearComposer() && mode === 'now') this.composer.setText('');
    } else if (this.clearComposer()) {
      this.composer.setText(prompt);
    } else {
      const current = this.composer.getState().text;
      this.composer.setText([current, prompt].filter((part) => part.trim()).join(' '));
    }
  }
}
