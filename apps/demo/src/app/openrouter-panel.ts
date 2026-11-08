import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DemoModels } from './demo-models';
import { OpenRouterAccount } from './openrouter-account';

const BUTTON =
  'inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:opacity-50';

/**
 * Connects the OpenRouter account of the visitor, for the free models: OpenRouter's sign-in, or a
 * pasted key. Says what the key is used for, where it is kept, and the limits of the free models.
 */
@Component({
  selector: 'nxa-demo-openrouter-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'relative',
    '(keydown.escape)': 'close($event)',
    '(focusout)': 'onFocusOut($event)',
  },
  template: `
    <button
      #trigger
      type="button"
      data-demo="openrouter-toggle"
      [class]="toggleClass()"
      aria-controls="demo-openrouter-panel"
      [attr.aria-expanded]="open()"
      (click)="toggle()"
    >
      <span
        aria-hidden="true"
        class="me-1.5 inline-block size-2 rounded-full align-middle"
        [class]="account.connected() ? 'bg-emerald-500' : 'bg-nxa-muted-foreground/50'"
      ></span>
      OpenRouter
      <span class="sr-only">{{ account.connected() ? '(connected)' : '(not connected)' }}</span>
    </button>
    <section
      id="demo-openrouter-panel"
      aria-label="OpenRouter account"
      class="absolute end-0 top-full z-40 mt-2 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl border border-nxa-border bg-nxa-background p-4 text-sm shadow-lg"
      [hidden]="!open()"
    >
      @if (account.connected()) {
        <p data-demo="openrouter-status">
          Connected. The free OpenRouter models are in the model menu of the composer.
        </p>
        <button
          type="button"
          data-demo="openrouter-disconnect"
          [class]="buttonClass"
          class="border border-nxa-border hover:bg-nxa-accent"
          (click)="disconnect()"
        >
          Disconnect
        </button>
      } @else {
        <p data-demo="openrouter-status">
          Try real models for free with your own
          <a class="underline" href="https://openrouter.ai" target="_blank" rel="noopener"
            >OpenRouter</a
          >
          account. Your key stays in this browser and is used only to call OpenRouter.
        </p>
        <a
          data-demo="openrouter-connect"
          role="link"
          tabindex="0"
          [class]="buttonClass"
          class="bg-nxa-primary text-nxa-primary-foreground hover:opacity-90 aria-disabled:pointer-events-none aria-disabled:opacity-50"
          [attr.href]="ready() ? signInUrl() : null"
          [attr.aria-disabled]="ready() ? null : 'true'"
        >
          {{ account.connecting() ? 'Connecting…' : 'Connect OpenRouter' }}
        </a>
        <form class="flex flex-col gap-2" (submit)="saveKey($event)">
          <label for="demo-openrouter-key" class="text-xs text-nxa-muted-foreground">
            Or paste an API key
          </label>
          <div class="flex gap-2">
            <input
              #keyInput
              id="demo-openrouter-key"
              type="password"
              autocomplete="off"
              spellcheck="false"
              placeholder="sk-or-…"
              class="h-8 min-w-0 flex-1 rounded-md border border-nxa-border bg-transparent px-2 outline-none focus-visible:ring-2 focus-visible:ring-nxa-ring"
            />
            <button
              type="submit"
              [class]="buttonClass"
              class="border border-nxa-border hover:bg-nxa-accent"
            >
              Save
            </button>
          </div>
        </form>
      }
      @if (account.error() ?? models.error(); as message) {
        <p data-demo="openrouter-error" role="alert" class="text-nxa-destructive">
          {{ message }}
        </p>
      }
      <p class="text-xs text-nxa-muted-foreground">
        Free models allow about 50 requests a day per account, and 20 a minute.
      </p>
      <p class="text-xs text-nxa-muted-foreground">
        Model names and logos are trademarks of their owners. ngx-assistant is not affiliated with
        them. Logos from Lobe Icons (MIT).
      </p>
    </section>
  `,
})
export class OpenRouterPanel {
  /** The classes of the button that opens the panel, as the other buttons of the header. */
  readonly toggleClass = input.required<string>();

  protected readonly account = inject(OpenRouterAccount);
  protected readonly models = inject(DemoModels);
  protected readonly buttonClass = BUTTON;
  protected readonly open = signal(false);
  /** Made when the panel opens: each address carries a new PKCE verifier. */
  protected readonly signInUrl = signal<string | undefined>(undefined);
  protected readonly ready = computed(() => !!this.signInUrl() && !this.account.connecting());

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly keyInput = viewChild<ElementRef<HTMLInputElement>>('keyInput');

  constructor() {
    // A sign-in that failed on the way back from OpenRouter says why, in the open panel.
    effect(() => {
      if (this.account.error()) untracked(() => this.open.set(true));
    });
    effect((onCleanup) => {
      if (!this.open() || this.account.connected()) {
        this.signInUrl.set(undefined);
        return;
      }
      let current = true;
      onCleanup(() => (current = false));
      void this.account.signInUrl().then((url) => {
        if (current) this.signInUrl.set(url);
      });
    });
  }

  protected toggle() {
    const open = !this.open();
    this.open.set(open);
    if (open) this.models.retry();
  }

  /** Disconnects; the focus goes back to the button, as the Disconnect button goes away. */
  protected disconnect() {
    this.account.disconnect();
    this.trigger().nativeElement.focus();
  }

  protected saveKey(event: Event) {
    event.preventDefault();
    const field = this.keyInput()?.nativeElement;
    if (!field?.value.trim()) return;
    this.account.useKey(field.value);
    field.value = '';
    this.trigger().nativeElement.focus();
  }

  protected close(event: Event) {
    if (!this.open()) return;
    event.preventDefault();
    this.open.set(false);
    this.trigger().nativeElement.focus();
  }

  /** The panel closes when the focus leaves it, as a popover does. */
  protected onFocusOut(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && !this.host.nativeElement.contains(next)) this.open.set(false);
  }
}
