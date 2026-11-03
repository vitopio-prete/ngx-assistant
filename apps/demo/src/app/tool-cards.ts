import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { injectToolCall } from '@ngx-assistant/angular';
import { NxaIcon } from './chat';

interface Forecast {
  city: string;
  temperature: number;
  condition: string;
}

const CARD =
  'my-1 flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-nxa-border bg-nxa-background p-4 text-sm text-nxa-foreground';

/**
 * The `get_weather` call, which the backend runs: the city while it runs, then the forecast, or
 * that it never came when the run stopped first.
 */
@Component({
  selector: 'nxa-demo-weather-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: CARD, 'data-tool': 'get_weather' },
  template: `
    @if (tool.result(); as forecast) {
      <p data-demo="tool-title" class="font-medium">{{ forecast.city }}</p>
      <p data-demo="tool-value" class="text-2xl font-semibold tabular-nums">
        {{ forecast.temperature }}°C, {{ forecast.condition }}
      </p>
    } @else if (tool.status().type === 'running') {
      <p role="status" class="text-nxa-muted-foreground">
        Checking the weather in {{ tool.args().city ?? '…' }}…
      </p>
    } @else {
      <p data-demo="tool-title" class="font-medium">{{ tool.args().city }}</p>
      <p data-demo="tool-outcome" class="text-nxa-muted-foreground">
        No forecast: the run stopped first
      </p>
    }
  `,
})
export class WeatherCard {
  protected readonly tool = injectToolCall<{ city?: string }, Forecast>();
}

interface EmailArgs {
  to?: string;
  subject?: string;
}

interface EmailAnswer {
  approved: boolean;
  to?: string;
}

const BUTTON =
  'flex h-8 items-center rounded-full px-3.5 text-xs font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-nxa-ring';

const OUTCOME: Record<string, string> = {
  approved: 'Approved',
  denied: 'Denied',
  unanswered: 'Not answered',
};

/**
 * The `send_email` call: the backend leaves it without a result, so the run waits until the user
 * approves or denies it here. The answer becomes the tool result, and the run goes on with it.
 */
@Component({
  selector: 'nxa-demo-email-approval',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaIcon],
  host: {
    class: CARD,
    role: 'group',
    'aria-label': 'Send an email?',
    'data-tool': 'send_email',
    '[attr.data-answer]': 'answer()',
  },
  template: `
    <div class="flex items-center gap-3">
      <span
        aria-hidden="true"
        class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-nxa-muted text-nxa-muted-foreground"
      >
        <nxa-icon name="sparkle" class="size-4" />
      </span>
      <div class="flex min-w-0 flex-col">
        <p class="font-medium">Send an email?</p>
        <p class="text-xs text-nxa-muted-foreground">Needs your approval</p>
      </div>
    </div>
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-nxa-muted px-3 py-2 text-xs">
      <dt class="text-nxa-muted-foreground">To</dt>
      <dd data-demo="email-to" class="truncate">{{ tool.args().to }}</dd>
      <dt class="text-nxa-muted-foreground">Subject</dt>
      <dd data-demo="email-subject" class="truncate">{{ tool.args().subject }}</dd>
    </dl>
    <div class="flex items-center gap-2">
      <!-- Always present, so screen readers announce the answer when it comes. -->
      <p
        #receipt
        role="status"
        tabindex="-1"
        data-demo="tool-outcome"
        class="flex flex-1 items-center gap-1.5 text-xs text-nxa-muted-foreground outline-none"
      >
        @if (outcome(); as text) {
          <nxa-icon [name]="answer() === 'approved' ? 'check' : 'circle-x'" class="size-3.5" />
          {{ text }}
        }
      </p>
      @if (answer() === 'pending') {
        <button
          type="button"
          class="text-nxa-foreground hover:bg-nxa-accent"
          [class]="button"
          (click)="respond(false)"
        >
          Deny
        </button>
        <button
          type="button"
          class="bg-nxa-primary text-nxa-primary-foreground hover:opacity-90"
          [class]="button"
          (click)="respond(true)"
        >
          Approve
        </button>
      }
    </div>
  `,
})
export class EmailApproval {
  protected readonly tool = injectToolCall<EmailArgs, EmailAnswer>();
  protected readonly button = BUTTON;

  /**
   * `pending` while the call waits for the user, `unanswered` once the run moved on without an
   * answer (a new message was sent instead), `streaming` while the model writes the call.
   */
  protected readonly answer = computed(() => {
    const result = this.tool.result();
    if (result) return result.approved ? 'approved' : 'denied';
    const status = this.tool.status().type;
    if (status === 'requires-action') return 'pending';
    return status === 'running' ? 'streaming' : 'unanswered';
  });
  protected readonly outcome = computed(() => OUTCOME[this.answer()]);

  private readonly receipt = viewChild.required<ElementRef<HTMLElement>>('receipt');
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  protected respond(approved: boolean) {
    // A second click must not replace the answer the backend already got.
    if (this.answer() !== 'pending') return;
    // The buttons go with the answer: the focus they had moves to the answer itself.
    const hadFocus = this.host.contains(this.host.ownerDocument.activeElement);
    this.tool.addResult({ approved, to: this.tool.args().to } satisfies EmailAnswer);
    if (hadFocus) {
      afterNextRender(() => this.receipt().nativeElement.focus({ preventScroll: true }), {
        injector: this.injector,
      });
    }
  }
}
