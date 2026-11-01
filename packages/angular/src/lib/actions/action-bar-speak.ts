import { Directive, booleanAttribute, computed, inject, input } from '@angular/core';
import { fromRuntime } from '../from-runtime';
import { injectMessage, injectThread } from '../scopes';
import { NXA_MESSAGE_UI_EVENTS, emitMessageUiEvent } from '../ui-events';
import { copyDisabled } from './action-state';

/**
 * A button that reads the nearest message aloud with the runtime's speech synthesis adapter,
 * stopping any other message being read. Disabled when the thread has no speech adapter, while
 * an assistant message is still running, or when the message has no text. It reports
 * `message.speak` to `injectNxaEvent()`. A capture-phase `click` listener can veto it with
 * `preventDefault()`.
 *
 * Pair it with `*nxaMessageIf="{ speaking: true }"` and `nxaActionBarStopSpeaking` to offer a stop
 * button while the message is being read.
 *
 * @example
 * ```html
 * <button *nxaMessageIf="{ speaking: false }; else stop" nxaActionBarSpeak>Read aloud</button>
 * <ng-template #stop><button nxaActionBarStopSpeaking>Stop</button></ng-template>
 * ```
 */
@Directive({
  selector: 'button[nxaActionBarSpeak]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaActionBarSpeak {
  /** Disables the button on top of the message state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly thread = injectThread();
  private readonly message = injectMessage();
  private readonly events = inject(NXA_MESSAGE_UI_EVENTS, { optional: true });
  private readonly noSpeech = fromRuntime(this.thread, (s) => s.capabilities.speech !== true);
  private readonly nothingToRead = copyDisabled(this.message);
  protected readonly isDisabled = computed(
    () => this.disabled() || this.noSpeech() || this.nothingToRead(),
  );

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    emitMessageUiEvent(this.events, this.thread, this.message, 'message.speak');
    this.message.speak();
  }
}

/**
 * A button that stops reading the nearest message aloud. Disabled while that message is not the
 * one being read. A capture-phase `click` listener can veto it with `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaActionBarStopSpeaking>Stop</button>
 * ```
 */
@Directive({
  selector: 'button[nxaActionBarStopSpeaking]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaActionBarStopSpeaking {
  /** Disables the button on top of the message state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly message = injectMessage();
  private readonly notSpeaking = fromRuntime(this.message, (s) => s.speech == null);
  protected readonly isDisabled = computed(() => this.disabled() || this.notSpeaking());

  protected onClick(event: MouseEvent) {
    // The runtime throws for a message that is not being read: `isDisabled` follows the runtime
    // synchronously, so a click after the reading ended stops here.
    if (event.defaultPrevented || this.isDisabled()) return;
    this.message.stopSpeaking();
  }
}
