import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { provideSuggestions } from '@ngx-assistant/angular';
import {
  NxaAssistantModal,
  NxaModelSelector,
  NxaModelSelectorIcon,
  NxaThread,
  NxaThreadList,
} from './chat';
import { AccountRow } from './account-row';
import { DEFAULT_MODEL, DemoModels } from './demo-models';
import { ModelIcon } from './model-icon';
import { OpenRouterAccount } from './openrouter-account';
import { OpenRouterLimit } from './openrouter-limit';
import { OPENROUTER_PREFIX } from '../backend/openrouter-models';

/** Where the chosen model and its reasoning effort are kept: in this browser only. */
export const MODEL_STORAGE = 'ngx-assistant-demo-model';
export const EFFORT_STORAGE = 'ngx-assistant-demo-effort';

function readSetting(key: string): string | undefined {
  try {
    return globalThis.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeSetting(key: string, value: string | undefined) {
  try {
    if (value === undefined) globalThis.localStorage.removeItem(key);
    else globalThis.localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked: the choice then lasts as long as the page.
  }
}

/** How the chat is shown: a full page with the conversations beside it, or a floating widget. */
type Layout = 'page' | 'widget';

const NOTICE_BUTTON =
  'shrink-0 rounded-md border border-nxa-border bg-nxa-background px-2 py-0.5 text-xs font-medium text-nxa-foreground outline-none hover:bg-nxa-accent focus-visible:ring-2 focus-visible:ring-nxa-ring';

const TOGGLE =
  'rounded-md px-2.5 py-1 text-sm outline-none hover:bg-nxa-accent focus-visible:ring-2 focus-visible:ring-nxa-ring aria-pressed:bg-nxa-muted aria-pressed:font-medium';

/**
 * The demo shell, on the runtimes of the app config. Every component under `./chat` was copied by
 * `ng add` and the generators, and is used as it was copied: the demo only gives them inputs and
 * providers. The model picked in the composer applies to every conversation: a simulated one, or a
 * free model of OpenRouter once the visitor signs in with an account, from the row at the bottom
 * of the sidebar (in the header of the widget layout). The choice is kept in this browser.
 */
@Component({
  selector: 'nxa-demo-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaThread,
    NxaThreadList,
    NxaAssistantModal,
    NxaModelSelector,
    NxaModelSelectorIcon,
    ModelIcon,
    AccountRow,
  ],
  host: {
    class: 'flex h-dvh flex-col bg-nxa-background text-nxa-foreground',
    '(click)': 'onSidebarClick($event)',
    '(keydown.escape)': 'closeSidebar($event)',
  },
  providers: [
    provideSuggestions([
      {
        title: 'Write some code',
        label: 'a component with signals',
        prompt: 'Write some code: a component with signals',
      },
      {
        title: 'Compare in a table',
        label: 'the runtimes of the library',
        prompt: 'Compare the runtimes in a table',
      },
      { title: 'Plan a day in Rome', label: 'a tool, then markdown', prompt: 'Plan a day in Rome' },
      {
        title: 'Send an email',
        label: 'a tool you approve',
        prompt: 'send an email to ada@example.com',
      },
    ]),
  ],
  template: `
    <!-- Says the notice of the daily limit when it appears: a live region already in the page. -->
    <p role="status" data-demo="limit-status" class="sr-only">{{ limitNotice() ?? '' }}</p>
    <header class="flex flex-wrap items-center gap-2 border-b border-nxa-border px-3 py-2">
      @if (layout() === 'page') {
        <button
          #sidebarToggle
          type="button"
          data-demo="sidebar-toggle"
          class="md:hidden"
          [class]="toggle"
          aria-controls="demo-sidebar"
          [attr.aria-expanded]="sidebarOpen()"
          (click)="sidebarOpen.set(!sidebarOpen())"
        >
          Threads
        </button>
      }
      <span class="text-sm font-semibold">ngx-assistant</span>
      <span class="hidden text-xs text-nxa-muted-foreground sm:inline">
        Simulated backend, or free models on OpenRouter
      </span>
      <div class="ms-auto flex items-center gap-1">
        @if (layout() === 'widget') {
          <nxa-demo-account placement="header" />
        }
        <div role="group" aria-label="Layout" class="flex items-center gap-1">
          @for (option of layouts; track option) {
            <button
              type="button"
              class="capitalize"
              [class]="toggle"
              [attr.aria-pressed]="layout() === option"
              (click)="layout.set(option)"
            >
              {{ option }}
            </button>
          }
        </div>
        <button
          type="button"
          data-demo="theme-toggle"
          [class]="toggle"
          [attr.aria-pressed]="dark()"
          (click)="dark.set(!dark())"
        >
          Dark theme
        </button>
      </div>
    </header>

    @if (layout() === 'page') {
      <div class="relative flex min-h-0 flex-1">
        <aside
          id="demo-sidebar"
          class="absolute inset-y-0 start-0 z-30 w-64 shrink-0 flex-col overflow-y-auto border-e border-nxa-border bg-nxa-background p-2 shadow-lg md:static md:flex md:shadow-none"
          [class.flex]="sidebarOpen()"
          [class.hidden]="!sidebarOpen()"
        >
          <nxa-thread-list class="flex-1">
            <p nxaThreadListFooter class="px-2.5 pb-1 text-xs text-nxa-muted-foreground">
              Threads and messages are saved in this browser. Reload the page: they are still here.
            </p>
            <nxa-demo-account nxaThreadListFooter />
          </nxa-thread-list>
        </aside>
        <nxa-thread class="min-h-0 flex-1" [welcome]="welcome">
          <nxa-model-selector
            nxaComposerTools
            variant="ghost"
            side="top"
            [models]="models()"
            [(value)]="model"
            [(effort)]="effort"
          >
            <ng-template nxaModelSelectorIcon let-model>
              <nxa-demo-model-icon [model]="model" />
            </ng-template>
          </nxa-model-selector>
          @if (limitNotice(); as notice) {
            <div nxaComposerNotice data-demo="limit-notice" [class]="noticeClass">
              <span class="min-w-0 flex-1">{{ notice }}</span>
              <button type="button" [class]="noticeButton" (click)="useShowcase()">
                Use Showcase
              </button>
            </div>
          }
        </nxa-thread>
      </div>
    } @else {
      <main
        class="mx-auto flex max-w-2xl flex-1 flex-col gap-4 p-8 text-sm text-nxa-muted-foreground"
      >
        <h1 class="text-2xl font-semibold text-nxa-foreground">A page with a chat widget</h1>
        <p>
          The button in the corner opens the same conversations in the assistant modal. Its Threads
          view picks another one or starts a new one, and its top corner resizes it.
        </p>
        <p>
          The Showcase model answers with markdown, code, tables, reasoning and tool calls, Echo
          repeats your message, and the backend asks before sending an email. Sign in with
          OpenRouter in the header to talk to free models instead. Edit a message or regenerate a
          reply to create branches, attach images or text files, or include /error or /error-stream
          to see a failure.
        </p>
      </main>
      <nxa-assistant-modal>
        <nxa-model-selector
          nxaComposerTools
          variant="ghost"
          side="top"
          [models]="models()"
          [(value)]="model"
          [(effort)]="effort"
        >
          <ng-template nxaModelSelectorIcon let-model>
            <nxa-demo-model-icon [model]="model" />
          </ng-template>
        </nxa-model-selector>
        @if (limitNotice(); as notice) {
          <div nxaComposerNotice data-demo="limit-notice" [class]="noticeClass">
            <span class="min-w-0 flex-1">{{ notice }}</span>
            <button type="button" [class]="noticeButton" (click)="useShowcase()">
              Use Showcase
            </button>
          </div>
        }
      </nxa-assistant-modal>
    }
  `,
})
export class App {
  private readonly account = inject(OpenRouterAccount);
  private readonly limit = inject(OpenRouterLimit);
  protected readonly models = inject(DemoModels).options;
  protected readonly layouts: readonly Layout[] = ['page', 'widget'];
  protected readonly welcome = 'How can I help?';
  protected readonly toggle = TOGGLE;
  protected readonly noticeButton = NOTICE_BUTTON;
  protected readonly noticeClass =
    'flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-nxa-foreground';

  /**
   * The chosen model, as saved. While it cannot be used (signed out, or the OpenRouter models are
   * not listed yet), the selector uses the first model it can, and comes back to this one later.
   */
  protected readonly model = signal<string | undefined>(
    readSetting(MODEL_STORAGE) ?? DEFAULT_MODEL,
  );
  protected readonly effort = signal<string | undefined>(readSetting(EFFORT_STORAGE));

  /** The model the runs use: the chosen one, or the first that can be used, as the selector does. */
  private readonly modelInUse = computed(() => {
    const models = this.models();
    const chosen = models.find((m) => m.id === this.model());
    return chosen && !chosen.disabled ? chosen.id : models.find((m) => !m.disabled)?.id;
  });

  /** The notice above the composer while the OpenRouter model in use is out of free requests. */
  protected readonly limitNotice = computed(() => {
    const resetAt = this.limit.resetAt();
    if (resetAt === undefined || !this.modelInUse()?.startsWith(OPENROUTER_PREFIX)) {
      return undefined;
    }
    // The day too, when the reset is not today.
    const today = new Date().toDateString() === new Date(resetAt).toDateString();
    const time = new Intl.DateTimeFormat(undefined, {
      ...(today ? {} : { weekday: 'long' }),
      hour: 'numeric',
      minute: '2-digit',
    }).format(resetAt);
    return (
      `You have used today's free requests on OpenRouter. They come back at ${time}. ` +
      'The simulated models still work.'
    );
  });
  protected readonly layout = signal<Layout>('page');
  /** Whether the conversations are shown on a narrow screen, where they cover the thread. */
  protected readonly sidebarOpen = signal(false);
  protected readonly dark = signal(
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
  );

  private readonly sidebarToggle = viewChild<ElementRef<HTMLElement>>('sidebarToggle');

  constructor() {
    // Back from OpenRouter's sign-in: the address carries the code for the key.
    void this.account.completeSignIn();
    // A sign-in that failed says why in the panel of the account row: on a narrow screen, the
    // sidebar opens to show it.
    effect(() => {
      if (this.account.error() && !this.account.connected()) {
        untracked(() => this.sidebarOpen.set(true));
      }
    });
    // The choice outlives the page.
    effect(() => writeSetting(MODEL_STORAGE, this.model()));
    effect(() => writeSetting(EFFORT_STORAGE, this.effort()));

    const root = inject(DOCUMENT).documentElement;
    effect(() => {
      root.classList.toggle('dark', this.dark());
      root.classList.toggle('light', !this.dark());
      // Native controls and scrollbars follow the theme too.
      root.style.colorScheme = this.dark() ? 'dark' : 'light';
    });
  }

  /** Switches to the Showcase model, which needs no requests of OpenRouter. */
  protected useShowcase() {
    this.model.set(DEFAULT_MODEL);
  }

  /** Picking or starting a conversation on a narrow screen shows it. */
  protected onSidebarClick(event: MouseEvent) {
    const pick = (event.target as Element).closest(
      '[data-slot="thread-list-item-trigger"], [data-slot="thread-list-new"]',
    );
    if (pick?.closest('#demo-sidebar')) {
      this.sidebarOpen.set(false);
    }
  }

  /** Escape closes the conversations on a narrow screen, back to the button that opened them. */
  protected closeSidebar(event: Event) {
    // An Escape that cancels something inside, such as a rename, is not for the sidebar.
    const target = event.target as Element;
    const field = target.matches('input, textarea');
    if (
      !this.sidebarOpen() ||
      !target.closest('#demo-sidebar') ||
      event.defaultPrevented ||
      field
    ) {
      return;
    }
    this.sidebarOpen.set(false);
    this.sidebarToggle()?.nativeElement.focus();
  }
}
