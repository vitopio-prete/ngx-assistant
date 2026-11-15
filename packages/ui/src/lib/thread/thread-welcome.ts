import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  NxaSuggestionDescription,
  NxaSuggestionTitle,
  NxaSuggestionTrigger,
  NxaSuggestions,
} from '@ngx-assistant/angular';

/**
 * What an empty thread shows: a greeting and the suggestions, which send their prompt when picked.
 * They slide in when the thread is shown, the suggestions one after the other.
 * Give the suggestions with `provideSuggestions(...)`, or let the runtime's thread provide them.
 */
@Component({
  selector: 'nxa-thread-welcome',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaSuggestions, NxaSuggestionTrigger, NxaSuggestionTitle, NxaSuggestionDescription],
  host: {
    class: 'flex flex-1 flex-col items-center justify-center gap-6 py-12',
    'data-slot': 'thread-welcome',
  },
  template: `
    <h2 class="nxa-animate-in nxa-slide-in-1 nxa-duration-200 text-center text-2xl font-semibold">
      {{ title() }}
    </h2>
    <div
      data-slot="thread-welcome-suggestions"
      class="grid w-full gap-2 empty:hidden sm:grid-cols-2 [&>:nth-child(2)]:[--nxa-enter-delay:50ms] [&>:nth-child(3)]:[--nxa-enter-delay:100ms] [&>:nth-child(n+4)]:[--nxa-enter-delay:150ms]"
    >
      <button
        *nxaSuggestions
        nxaSuggestionTrigger
        send
        class="nxa-animate-in nxa-slide-in-2 nxa-duration-200 flex flex-col items-start gap-0.5 rounded-2xl border border-nxa-border px-4 py-3 text-start text-sm transition-colors outline-none hover:bg-nxa-accent focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:opacity-50"
      >
        <span nxaSuggestionTitle class="font-medium"></span>
        <span nxaSuggestionDescription class="text-nxa-muted-foreground empty:hidden"></span>
      </button>
    </div>
  `,
})
export class NxaThreadWelcome {
  readonly title = input('How can I help you today?');
}
