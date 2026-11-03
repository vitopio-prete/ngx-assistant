import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { provideSuggestions, type ModelOption } from '@ngx-assistant/angular';
import { NxaAssistantModal, NxaModelSelector, NxaThread, NxaThreadList } from './chat';

/** A small stroked icon as a `data:` URL, for the `icon` of a model. */
const icon = (color: string, path: string) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" ` +
      `stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`,
  );

/**
 * The models the demo backend knows: the request names the one picked. The last one shows a model
 * the user cannot pick yet.
 */
const MODELS: readonly ModelOption[] = [
  {
    id: 'echo',
    name: 'Echo',
    description: 'Repeats your message',
    icon: icon('#0d9488', 'M3 12h2 M7 8v8 M11 5v14 M15 8v8 M19 11v2'),
    efforts: true,
  },
  {
    id: 'shout',
    name: 'Shout',
    description: 'Repeats it in capitals',
    icon: icon('#ea580c', 'M4 10v4h3l7 4V6l-7 4z M18 9a4 4 0 0 1 0 6'),
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'Sign in to use',
    icon: icon('#7c3aed', 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z'),
    disabled: true,
  },
];

/** How the chat is shown: a full page with the conversations beside it, or a floating widget. */
type Layout = 'page' | 'widget';

const TOGGLE =
  'rounded-md px-2.5 py-1 text-sm outline-none hover:bg-nxa-accent focus-visible:ring-2 focus-visible:ring-nxa-ring aria-pressed:bg-nxa-muted aria-pressed:font-medium';

/**
 * The demo shell, on the runtimes of the app config. Every component under `./chat` was copied by
 * `ng add` and the generators, and is used as it was copied: the demo only gives them inputs and
 * providers. The model picked in the composer applies to every conversation.
 */
@Component({
  selector: 'nxa-demo-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaThread, NxaThreadList, NxaAssistantModal, NxaModelSelector],
  host: {
    class: 'flex h-dvh flex-col bg-nxa-background text-nxa-foreground',
    '(click)': 'onSidebarClick($event)',
    '(keydown.escape)': 'closeSidebar($event)',
  },
  providers: [
    provideSuggestions([
      { title: 'Say hello', label: 'a first message', prompt: 'Hello there!' },
      { title: 'Check the weather', label: 'a tool the backend runs', prompt: 'weather in Rome' },
      {
        title: 'Send an email',
        label: 'a tool you approve',
        prompt: 'send an email to ada@example.com',
      },
      { title: 'Show an error', label: 'a request that fails', prompt: '/error please' },
    ]),
  ],
  template: `
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
        Backend simulated in the browser
      </span>
      <div class="ms-auto flex items-center gap-1">
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
          <nxa-thread-list class="flex-1" />
          <p class="mt-4 px-2.5 text-xs text-nxa-muted-foreground">
            Threads and messages are saved in this browser. Reload the page: they are still here.
          </p>
        </aside>
        <nxa-thread class="min-h-0 flex-1" [welcome]="welcome">
          <nxa-model-selector
            nxaComposerTools
            variant="ghost"
            side="top"
            [models]="models"
            [(value)]="model"
            [(effort)]="effort"
          />
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
          The backend echoes your message word by word, checks the weather in a city, or asks before
          sending an email. Edit a message or regenerate a reply to create branches, attach images
          or text files, or include /error or /error-stream to see a failure.
        </p>
      </main>
      <nxa-assistant-modal>
        <nxa-model-selector
          nxaComposerTools
          variant="ghost"
          side="top"
          [models]="models"
          [(value)]="model"
          [(effort)]="effort"
        />
      </nxa-assistant-modal>
    }
  `,
})
export class App {
  protected readonly models = MODELS;
  protected readonly layouts: readonly Layout[] = ['page', 'widget'];
  protected readonly welcome = 'How can I help?';
  protected readonly toggle = TOGGLE;

  protected readonly model = signal<string | undefined>('echo');
  protected readonly effort = signal<string | undefined>(undefined);
  protected readonly layout = signal<Layout>('page');
  /** Whether the conversations are shown on a narrow screen, where they cover the thread. */
  protected readonly sidebarOpen = signal(false);
  protected readonly dark = signal(
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
  );

  private readonly sidebarToggle = viewChild<ElementRef<HTMLElement>>('sidebarToggle');

  constructor() {
    const root = inject(DOCUMENT).documentElement;
    effect(() => {
      root.classList.toggle('dark', this.dark());
      root.classList.toggle('light', !this.dark());
      // Native controls and scrollbars follow the theme too.
      root.style.colorScheme = this.dark() ? 'dark' : 'light';
    });
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
