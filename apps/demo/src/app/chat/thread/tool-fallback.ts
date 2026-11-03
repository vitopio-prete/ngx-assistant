import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { injectScrollLock, injectToolCall } from '@ngx-assistant/angular';
import { NxaIcon, type NxaIconName } from '../icons';
import { NxaToolApproval } from './tool-approval';

// The result of a call allowed or denied without an approval request (a human-in-the-loop tool
// with no UI of its own). Register a tool UI to send a result of your own instead.
const APPROVED_RESULT = 'Approved by user';
const DENIED_RESULT = 'User denied tool execution';

/** A value as text: a string as is, anything else as JSON when it has one. */
export const formatToolValue = (value: unknown, space?: number): string => {
  if (typeof value === 'string') return value;
  try {
    if (value instanceof Error) return String(value);
    const json = JSON.stringify(value, null, space);
    if (json !== undefined) return json;
  } catch {
    // Falls back to String() below.
  }
  try {
    return String(value);
  } catch {
    return '[Unserializable value]';
  }
};

/** A duration as `<1s`, `2.4s`, `12s` or `1m 5s`. */
export const formatToolDuration = (ms: number): string => {
  if (ms < 1000) return '<1s';
  const seconds = ms / 1000;
  if (seconds < 10) return `${(Math.floor(seconds * 10) / 10).toFixed(1)}s`;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
};

let nextId = 0;

/**
 * A tool call that has no UI of its own (register it with `provideToolUi({ fallback })`): its
 * status, how long it ran, its arguments, its result or error, and the controls that answer it
 * when the run waits on the user. It opens by itself when an answer is needed.
 */
@Component({
  selector: 'nxa-tool-fallback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaIcon, NxaToolApproval],
  host: { class: 'block w-full', 'data-slot': 'tool-fallback-root' },
  template: `
    @let call = tool.part();
    <button
      type="button"
      data-slot="tool-fallback-trigger"
      [attr.data-state]="open() ? 'open' : 'closed'"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="contentId"
      class="group/trigger flex w-fit items-center gap-2 rounded-md py-1.5 text-sm text-nxa-muted-foreground transition-colors outline-none hover:text-nxa-foreground focus-visible:ring-2 focus-visible:ring-nxa-ring"
      (click)="toggle()"
    >
      <nxa-icon
        [name]="icon()"
        class="size-4"
        [class.animate-spin]="isRunning()"
        [class.text-nxa-destructive]="statusType() === 'incomplete' && !isCancelled()"
      />
      <span
        class="text-start leading-none"
        [class.line-through]="isCancelled()"
        [class.animate-pulse]="isRunning()"
        >{{ label() }}: <b class="font-semibold">{{ call.toolName }}</b></span
      >
      @if (duration(); as time) {
        <span data-slot="tool-fallback-duration" class="text-xs tabular-nums">{{ time }}</span>
      }
      <nxa-icon
        name="chevron-down"
        class="size-4 -rotate-90 transition-transform duration-200 group-data-[state=open]/trigger:rotate-0 motion-reduce:transition-none"
      />
    </button>
    @if (open()) {
      <div
        data-slot="tool-fallback-content"
        [id]="contentId"
        class="flex flex-col gap-2 pt-1 pb-2 ps-6 text-sm"
      >
        @if (errorText(); as error) {
          <div data-slot="tool-fallback-error">
            <p class="font-semibold text-nxa-muted-foreground">
              {{ isCancelled() ? 'Cancelled reason:' : 'Error:' }}
            </p>
            <p class="whitespace-pre-line text-nxa-muted-foreground">{{ error }}</p>
          </div>
        }
        @if (call.argsText) {
          <pre
            data-slot="tool-fallback-args"
            class="rounded-md bg-nxa-muted p-2.5 text-xs whitespace-pre-wrap"
            [class.opacity-60]="isCancelled()"
            >{{ call.argsText }}</pre>
        }
        @if (call.approval) {
          <nxa-tool-approval />
        } @else if (offersDecision()) {
          <div data-slot="tool-fallback-decision" class="flex items-center gap-2 pt-1">
            <button
              type="button"
              class="inline-flex items-center rounded-lg bg-nxa-primary px-3 py-1.5 text-sm font-medium text-nxa-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:pointer-events-none disabled:opacity-50"
              [disabled]="answered()"
              (click)="decide(true)"
            >
              Allow
            </button>
            <button
              type="button"
              class="inline-flex items-center rounded-lg border border-nxa-border px-3 py-1.5 text-sm font-medium outline-none hover:bg-nxa-accent focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:pointer-events-none disabled:opacity-50"
              [disabled]="answered()"
              (click)="decide(false)"
            >
              Deny
            </button>
          </div>
          @if (decisionError(); as error) {
            <p role="alert" class="text-xs whitespace-pre-line text-nxa-destructive">{{ error }}</p>
          }
        }
        @if (call.result !== undefined) {
          <div data-slot="tool-fallback-result">
            <p class="text-xs font-medium text-nxa-muted-foreground">Result:</p>
            <pre class="mt-1 rounded-md bg-nxa-muted p-2.5 text-xs whitespace-pre-wrap">{{
              result()
            }}</pre>
          </div>
        }
      </div>
    }
  `,
})
export class NxaToolFallback {
  protected readonly tool = injectToolCall();
  protected readonly contentId = `nxa-tool-fallback-${nextId++}`;

  protected readonly statusType = computed(() => this.tool.status().type);
  protected readonly isRunning = computed(() => this.statusType() === 'running');
  protected readonly requiresAction = computed(() => this.statusType() === 'requires-action');
  protected readonly isCancelled = computed(() => {
    const status = this.tool.status();
    return status.type === 'incomplete' && status.reason === 'cancelled';
  });

  protected readonly label = computed(() => {
    if (this.tool.part().responseDeliveryStatus === 'queued') return 'Reply queued, not sent yet';
    switch (this.statusType()) {
      case 'running':
        return 'Running tool';
      case 'requires-action':
        return 'Waiting on tool';
      case 'incomplete':
        return this.isCancelled() ? 'Cancelled tool' : 'Failed tool';
      default:
        return 'Used tool';
    }
  });

  protected readonly icon = computed((): NxaIconName => {
    switch (this.statusType()) {
      case 'running':
        return 'loader';
      case 'requires-action':
        return 'circle-alert';
      case 'incomplete':
        return 'circle-x';
      default:
        return 'check';
    }
  });

  protected readonly errorText = computed(() => {
    const status = this.tool.status();
    if (status.type !== 'incomplete' || status.error === undefined || status.error === null) {
      return null;
    }
    return formatToolValue(status.error) || null;
  });

  protected readonly result = computed(() => formatToolValue(this.tool.result(), 2));

  // While the call runs, a clock ticks once a second; a finished call shows its total time.
  private readonly startedAt = computed(() => this.tool.part().timing?.startedAt);
  private readonly completedAt = computed(() => this.tool.part().timing?.completedAt);
  private readonly now = signal<number | undefined>(undefined);
  protected readonly duration = computed(() => {
    const startedAt = this.startedAt();
    if (startedAt === undefined) return undefined;
    const completedAt = this.completedAt();
    if (completedAt !== undefined) return formatToolDuration(Math.max(0, completedAt - startedAt));
    const now = this.now();
    if (!this.isRunning() || now === undefined) return undefined;
    return formatToolDuration(Math.max(0, now - startedAt));
  });

  /** A call waiting on the user without an approval request: allowed or denied by a result. */
  protected readonly offersDecision = computed(() => {
    const status = this.tool.status();
    if (status.type !== 'requires-action') return false;
    return status.reason !== 'interrupt' || this.tool.part().interrupt !== undefined;
  });
  // Answering locks the buttons until the call stops waiting; a later request starts afresh.
  protected readonly answered = linkedSignal({
    source: () => this.offersDecision() && this.tool.part().interrupt,
    computation: () => false,
  });
  /** Why the last answer was refused, until the next one. */
  protected readonly decisionError = signal<string | null>(null);

  protected readonly open = signal(untracked(this.requiresAction));
  private readonly lockScroll = injectScrollLock(inject(ElementRef), 200);

  constructor() {
    effect(() => {
      if (this.requiresAction()) untracked(() => this.open.set(true));
    });
    effect((onCleanup) => {
      if (this.startedAt() === undefined || this.completedAt() !== undefined) return;
      if (!this.isRunning()) return;
      this.now.set(Date.now());
      const id = setInterval(() => this.now.set(Date.now()), 1000);
      onCleanup(() => clearInterval(id));
    });
  }

  protected toggle() {
    this.lockScroll();
    this.open.update((open) => !open);
  }

  // A refused answer gives the buttons back, with the reason, rather than leaving them locked.
  protected decide(approved: boolean) {
    if (this.answered()) return;
    this.answered.set(true);
    this.decisionError.set(null);
    try {
      if (this.tool.part().interrupt) this.tool.resume({ approved });
      else this.tool.addResult(approved ? APPROVED_RESULT : DENIED_RESULT);
    } catch (error) {
      this.answered.set(false);
      this.decisionError.set(error instanceof Error ? error.message : String(error));
    }
  }
}
