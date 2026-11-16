import { forecastFor } from './weather';

/**
 * The replies of the Showcase model: written in advance, picked from the words of the message, so
 * they cost nothing and show every kind of part the components render (markdown with headings,
 * lists, tables and code, reasoning, and a tool call followed by text that uses its result).
 */

/** A reply: its reasoning, then its text, after a `get_weather` call when `city` is set. */
export interface ShowcaseReply {
  reasoning: string;
  /** The city of the `get_weather` call to make before the text. */
  city?: string;
  /** The text, given the result of the `get_weather` call when there is one. */
  text: (forecast?: ReturnType<typeof forecastFor>) => string;
}

const PLAN = /plan (?:a |my )?(?:day|trip|visit|weekend) (?:in|to) ([^?.!,\n]+)/i;
const TABLE = /\b(table|compare|comparison|versus|vs)\b/i;
const CODE = /\b(code|example|snippet|signals?|angular|typescript|component)\b/i;
const GREETING = /^\s*(hello|hi|hey|ciao)\b/i;

/** What a higher reasoning effort adds to the reasoning. */
const MORE_REASONING: Record<string, readonly string[]> = {
  low: [],
  medium: ['I keep each section short, so the reply reads well on a phone too.'],
  high: [
    'I keep each section short, so the reply reads well on a phone too.',
    'Last, I check that the headings, lists and code blocks stay valid markdown while they stream.',
  ],
};

/** The first words of a reply: each regenerated take starts differently. */
function opener(take: number): string {
  if (take === 1) return 'Sure.';
  if (take === 2) return 'Here is another take.';
  return `Take ${take}, once more.`;
}

const lines = (...rows: string[]) => rows.join('\n');

function codeReply(take: number): string {
  return lines(
    '## Signals in a component',
    '',
    `${opener(take)} Here is a small component that keeps its state in a **signal** and derives a value with \`computed()\`.`,
    '',
    '```ts',
    'import {',
    '  ChangeDetectionStrategy,',
    '  Component,',
    '  computed,',
    '  signal,',
    "} from '@angular/core';",
    '',
    '@Component({',
    "  selector: 'app-counter',",
    '  changeDetection: ChangeDetectionStrategy.OnPush,',
    '  template: `',
    '    <button type="button" (click)="count.set(count() + 1)">Add one</button>',
    '    <p>{{ count() }} clicks, {{ double() }} doubled</p>',
    '  `,',
    '})',
    'export class Counter {',
    '  protected readonly count = signal(0);',
    '  protected readonly double = computed(() => this.count() * 2);',
    '}',
    '```',
    '',
    '### What happens',
    '',
    '1. `signal(0)` holds the state.',
    '2. `computed()` reads it, and changes when it changes.',
    '3. The template reads both: without zone.js, only this view updates on a click.',
  );
}

function tableReply(take: number): string {
  return lines(
    '## The runtimes, side by side',
    '',
    `${opener(take)} Each runtime keeps the conversation in a different place:`,
    '',
    '| Runtime | Where the messages live | Good for |',
    '| --- | --- | --- |',
    '| `provideLocalRuntime` | In the browser | A model adapter of your own |',
    '| `provideDataStreamRuntime` | Streamed by your backend | An AI SDK route |',
    '| `provideExternalStoreRuntime` | In a store you own | State you already manage |',
    '| `provideRemoteThreadListRuntime` | On your backend, per conversation | Saved conversations, like here |',
    '',
    'This demo uses the last two together: each saved conversation runs on its own data stream runtime.',
  );
}

function planReply(take: number, forecast: ReturnType<typeof forecastFor>): string {
  const indoor = forecast.condition === 'rainy' || forecast.condition === 'foggy';
  const city = forecast.city;
  return lines(
    `## A day in ${city}`,
    '',
    `${opener(take)} It is **${forecast.temperature}°C** and ${forecast.condition} in ${city}, so here is a plan that fits.`,
    '',
    '### Morning',
    '',
    indoor
      ? '- A museum while the weather clears up'
      : '- A walk through the old town before the crowds',
    '- Coffee where the locals have it',
    '',
    '### Afternoon',
    '',
    indoor ? '- A covered market, for lunch and for a look around' : '- Lunch outside, then a park',
    '- An hour with nothing planned',
    '',
    '### Evening',
    '',
    '1. Dinner near the center',
    `2. ${indoor ? 'A concert or a film' : 'A last walk at sunset'}`,
    '',
    `> The weather came from the \`get_weather\` tool, which the backend ran before writing this.`,
  );
}

function greetingReply(take: number): string {
  return lines(
    '## Hello!',
    '',
    `${opener(take)} I am **Showcase**, a simulated model: my replies are written in advance, so they cost nothing. Try one of these:`,
    '',
    '- **Write some code**, for a code block',
    '- **Compare the runtimes in a table**, for a table',
    '- **Plan a day in Rome**, for a tool call and a reply that uses its result',
    '- **Send an email to ada@example.com**, for a tool you approve first',
    '',
    'Sign in with OpenRouter at the bottom of the sidebar to talk to real models, for free.',
  );
}

function defaultReply(take: number, text: string): string {
  const topic = text.replace(/\s+/g, ' ').trim();
  const short = topic.length > 60 ? `${topic.slice(0, 57)}…` : topic;
  return lines(
    `## About “${short || 'your message'}”`,
    '',
    `${opener(take)} I am a simulated model, so I cannot really answer that, but here is what a reply can hold.`,
    '',
    '### Lists',
    '',
    '- **Bold**, *italic* and `inline code`',
    '- [Links](https://angular.dev), which open in a new tab',
    '- Nested items:',
    '  - one',
    '  - two',
    '',
    '### A table',
    '',
    '| Part | How it shows |',
    '| --- | --- |',
    '| Text | Markdown, streamed block by block |',
    '| Reasoning | Folded above the reply |',
    '| Tools | A card for each call |',
    '',
    '### Code',
    '',
    '```bash',
    'ng add @ngx-assistant/angular',
    '```',
  );
}

/** The reply of the Showcase model to `text`, for the `take`-th time it is asked. */
export function showcaseReply(text: string, take: number, effort?: string): ShowcaseReply {
  const more = MORE_REASONING[effort ?? 'low'] ?? [];
  const reasoning = (...first: string[]) => [...first, ...more].join(' ');

  const plan = PLAN.exec(text);
  if (plan) {
    const city = plan[1].trim();
    return {
      city,
      reasoning: reasoning(
        `The message asks for a day in ${city}, which depends on the weather.`,
        'I call get_weather first, then plan indoor or outdoor activities from its result.',
      ),
      text: (forecast) => planReply(take, forecast ?? forecastFor(city)),
    };
  }
  if (TABLE.test(text)) {
    return {
      reasoning: reasoning(
        'The message asks for a comparison, which reads best as a table.',
        'One row for each runtime, with where its messages live and what it is good for.',
      ),
      text: () => tableReply(take),
    };
  }
  if (CODE.test(text)) {
    return {
      reasoning: reasoning(
        'The message asks for code, so the reply leads with a short component.',
        'A numbered list then says what each part does.',
      ),
      text: () => codeReply(take),
    };
  }
  if (GREETING.test(text)) {
    return {
      reasoning: reasoning(
        'A greeting: I say who I am and list what to try.',
        'Each item names a prompt and the part it shows.',
      ),
      text: () => greetingReply(take),
    };
  }
  return {
    reasoning: reasoning(
      'The message is about something I have no reply written for.',
      'I show the parts a reply can hold instead: lists, a table and a code block.',
    ),
    text: () => defaultReply(take, text),
  };
}
