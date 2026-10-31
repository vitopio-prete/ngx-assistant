import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { injectToolCall } from '@ngx-assistant/angular';

interface Forecast {
  city: string;
  temperature: number;
  condition: string;
}

/**
 * The `get_weather` call, which the backend runs: the city while it runs, then the forecast, or
 * that it never came when the run stopped first.
 */
@Component({
  selector: 'nxa-demo-weather-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tool-card', 'data-tool': 'get_weather' },
  template: `
    @if (tool.result(); as forecast) {
      <strong>{{ forecast.city }}</strong>
      <span class="tool-value">{{ forecast.temperature }}°C, {{ forecast.condition }}</span>
    } @else if (tool.status().type === 'running') {
      <span role="status">Checking the weather in {{ tool.args().city ?? '…' }}…</span>
    } @else {
      <strong>{{ tool.args().city }}</strong>
      <span class="tool-outcome">No forecast: the run stopped first</span>
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

/**
 * The `send_email` call: the backend leaves it without a result, so the run waits until the user
 * approves or denies it here. The answer becomes the tool result, and the run goes on with it.
 */
@Component({
  selector: 'nxa-demo-email-approval',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'tool-card',
    'data-tool': 'send_email',
    '[attr.data-answer]': 'answer()',
  },
  template: `
    <strong>Send an email?</strong>
    <span class="tool-value">To {{ tool.args().to }}: “{{ tool.args().subject }}”</span>
    @switch (answer()) {
      @case ('pending') {
        <div class="tool-actions">
          <button type="button" class="primary" (click)="respond(true)">Approve</button>
          <button type="button" class="secondary" (click)="respond(false)">Deny</button>
        </div>
      }
      @case ('approved') {
        <span class="tool-outcome">Approved</span>
      }
      @case ('denied') {
        <span class="tool-outcome">Denied</span>
      }
      @case ('unanswered') {
        <span class="tool-outcome">Not answered</span>
      }
    }
  `,
})
export class EmailApproval {
  protected readonly tool = injectToolCall<EmailArgs, EmailAnswer>();

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

  protected respond(approved: boolean) {
    // A second click must not replace the answer the backend already got.
    if (this.answer() !== 'pending') return;
    this.tool.addResult({ approved, to: this.tool.args().to } satisfies EmailAnswer);
  }
}

/** Any other tool: its name, arguments and result. */
@Component({
  selector: 'nxa-demo-tool-fallback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tool-card' },
  template: `
    <strong>{{ tool.part().toolName }}</strong>
    <code class="tool-value">{{ args() }}</code>
  `,
})
export class ToolFallback {
  protected readonly tool = injectToolCall();
  protected readonly args = computed(() => JSON.stringify(this.tool.args()));
}
