import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  NxaSuggestionDescription,
  NxaSuggestionTitle,
  NxaSuggestionTrigger,
  NxaSuggestions,
} from '@ngx-assistant/angular';
import { NxaIcon } from '../icons';

/**
 * The suggestions of an empty thread, which send their prompt when picked. `list` shows a row
 * each, title then description, as under a centered composer; `grid` shows cards, two per row on
 * wider screens. They slide in one after the other. Renders nothing without suggestions.
 *
 * Give the suggestions with `provideSuggestions(...)`, or let the runtime's thread provide them.
 */
@Component({
  selector: 'nxa-thread-suggestions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaSuggestions,
    NxaSuggestionTrigger,
    NxaSuggestionTitle,
    NxaSuggestionDescription,
    NxaIcon,
  ],
  host: {
    'data-slot': 'thread-welcome-suggestions',
    '[attr.data-variant]': 'variant()',
    '[class]': 'variant() === "grid" ? gridClass : listClass',
  },
  template: `
    @if (variant() === 'grid') {
      <button
        *nxaSuggestions
        nxaSuggestionTrigger
        send
        class="nxa-animate-in nxa-slide-in-2 nxa-duration-200 flex flex-col items-start gap-0.5 rounded-2xl border border-nxa-border px-4 py-3 text-start text-sm transition-colors outline-none hover:bg-nxa-accent focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:opacity-50"
      >
        <span nxaSuggestionTitle class="font-medium"></span>
        <span nxaSuggestionDescription class="text-nxa-muted-foreground empty:hidden"></span>
      </button>
    } @else {
      <button
        *nxaSuggestions
        nxaSuggestionTrigger
        send
        class="group nxa-animate-in nxa-slide-in-2 nxa-duration-200 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-start text-sm transition-colors outline-none hover:bg-[color-mix(in_oklab,var(--nxa-foreground)_4%,transparent)] focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:opacity-50"
      >
        <nxa-icon
          name="chevron-right"
          class="size-3.5 text-nxa-muted-foreground/60 transition-colors group-hover:text-nxa-foreground"
        />
        <span class="min-w-0 flex-1 truncate">
          <span nxaSuggestionTitle></span>{{ ' '
          }}<span nxaSuggestionDescription class="text-nxa-muted-foreground empty:hidden"></span>
        </span>
      </button>
    }
  `,
})
export class NxaThreadSuggestions {
  /** `list` (a row per suggestion) or `grid` (cards). */
  readonly variant = input<'list' | 'grid'>('list');

  protected readonly listClass =
    'flex w-full flex-col empty:hidden [&>:nth-child(2)]:[--nxa-enter-delay:50ms] [&>:nth-child(3)]:[--nxa-enter-delay:100ms] [&>:nth-child(n+4)]:[--nxa-enter-delay:150ms]';
  protected readonly gridClass =
    'grid w-full gap-2 empty:hidden sm:grid-cols-2 [&>:nth-child(2)]:[--nxa-enter-delay:50ms] [&>:nth-child(3)]:[--nxa-enter-delay:100ms] [&>:nth-child(n+4)]:[--nxa-enter-delay:150ms]';
}
