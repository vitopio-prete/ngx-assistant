import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  NxaSuggestionDescription,
  NxaSuggestionTitle,
  NxaSuggestionTrigger,
  NxaSuggestions,
} from '@ngx-assistant/angular';

/**
 * What an empty thread shows: a greeting and the suggestions, which send their prompt when picked.
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
    <h2 class="text-center text-2xl font-semibold">{{ title() }}</h2>
    <div class="grid w-full gap-2 empty:hidden sm:grid-cols-2">
      <button
        *nxaSuggestions
        nxaSuggestionTrigger
        send
        class="flex flex-col items-start gap-0.5 rounded-2xl border border-nxa-border px-4 py-3 text-start text-sm transition-colors outline-none hover:bg-nxa-accent focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:opacity-50"
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
