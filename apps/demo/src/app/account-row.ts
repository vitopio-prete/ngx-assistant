import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import {
  CdkConnectedOverlay,
  CdkOverlayOrigin,
  type ConnectedPosition,
} from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MENU_ITEM, MENU_ITEM_DESTRUCTIVE, MENU_PANEL } from './chat';
import { DemoModels } from './demo-models';
import { OPENROUTER_KEYS_PAGE, OpenRouterAccount } from './openrouter-account';

/** The last sign-in error the panel opened for by itself. */
let shownError: string | undefined;

/** Where the account row is: at the bottom of the sidebar, or in the header of the page. */
export type AccountPlacement = 'sidebar' | 'header';

const BUTTON =
  'inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:opacity-50';

const ROW =
  'flex items-center gap-2.5 rounded-lg text-start text-sm outline-none hover:bg-nxa-accent focus-visible:ring-2 focus-visible:ring-nxa-ring aria-expanded:bg-nxa-accent';

/** Above the row in the sidebar (below when there is no room); below it in the header. */
const ABOVE: ConnectedPosition[] = [
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
];
const BELOW: ConnectedPosition[] = [
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
  { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -6 },
];

/**
 * The OpenRouter account of the visitor, as the account row of a chat app: "Sign in with
 * OpenRouter" until an account is connected, then the account with a menu to manage or disconnect
 * it. Signing in opens a panel with OpenRouter's sign-in (OAuth with PKCE) or a pasted key, which
 * says where the key is kept and the limits of the free models.
 */
@Component({
  selector: 'nxa-demo-account',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, CdkMenuTrigger, CdkMenu, CdkMenuItem],
  host: { class: 'block' },
  template: `
    @if (account.connected()) {
      <button
        #trigger
        type="button"
        data-demo="account-menu-trigger"
        [class]="rowClass()"
        [cdkMenuTriggerFor]="menu"
        [cdkMenuPosition]="positions()"
      >
        <span
          aria-hidden="true"
          class="flex size-7 shrink-0 items-center justify-center rounded-full bg-nxa-primary text-nxa-primary-foreground"
        >
          <span
            class="block size-4 bg-current"
            [style.mask]="logo"
            [style.-webkit-mask]="logo"
          ></span>
        </span>
        @if (placement() === 'sidebar') {
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate font-medium">OpenRouter</span>
            <span data-demo="account-label" class="truncate text-xs text-nxa-muted-foreground">
              {{ account.label() }}{{ account.freeTier() ? ' · Free tier' : '' }}
            </span>
          </span>
        } @else {
          <span data-demo="account-label" class="max-w-40 truncate">{{ account.label() }}</span>
        }
        <span class="sr-only">, account menu</span>
      </button>
      <ng-template #menu>
        <div cdkMenu data-demo="account-menu" [class]="menuPanel">
          <a
            cdkMenuItem
            data-demo="account-manage"
            [class]="menuItem"
            [href]="keysPage"
            target="_blank"
            rel="noopener"
          >
            Manage keys on OpenRouter
          </a>
          <button
            cdkMenuItem
            type="button"
            data-demo="openrouter-disconnect"
            [class]="menuItemDestructive"
            (cdkMenuItemTriggered)="disconnect()"
          >
            Disconnect
          </button>
        </div>
      </ng-template>
    } @else {
      <button
        #trigger
        type="button"
        cdkOverlayOrigin
        #origin="cdkOverlayOrigin"
        data-demo="account-sign-in"
        [class]="rowClass()"
        [attr.aria-controls]="open() ? 'demo-openrouter-panel' : null"
        aria-haspopup="dialog"
        [attr.aria-expanded]="open()"
        (click)="toggle()"
      >
        <span
          aria-hidden="true"
          class="flex size-7 shrink-0 items-center justify-center rounded-full border border-nxa-border"
        >
          <span
            class="block size-4 bg-current"
            [style.mask]="logo"
            [style.-webkit-mask]="logo"
          ></span>
        </span>
        @if (placement() === 'sidebar') {
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate font-medium">Sign in with OpenRouter</span>
            <span class="truncate text-xs text-nxa-muted-foreground"> Free real models </span>
          </span>
        } @else {
          <span class="whitespace-nowrap font-medium">Sign in with OpenRouter</span>
        }
      </button>
      <ng-template
        cdkConnectedOverlay
        [cdkConnectedOverlayOrigin]="origin"
        [cdkConnectedOverlayOpen]="open()"
        [cdkConnectedOverlayPositions]="positions()"
        [cdkConnectedOverlayViewportMargin]="8"
        (overlayOutsideClick)="onOutsideClick($event)"
        (overlayKeydown)="onOverlayKeydown($event)"
        (attach)="focusPanel()"
      >
        <section
          #panel
          id="demo-openrouter-panel"
          role="dialog"
          aria-labelledby="demo-openrouter-title"
          tabindex="-1"
          (focusout)="onPanelFocusOut($event)"
          class="nxa-animate-in nxa-zoom-in-95 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl border border-nxa-border bg-nxa-background p-4 text-sm text-nxa-foreground shadow-lg outline-none"
        >
          <h2 id="demo-openrouter-title" class="font-semibold">Sign in with OpenRouter</h2>
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
            {{ account.connecting() ? 'Connecting…' : 'Continue to OpenRouter' }}
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
          @if (account.error() ?? models.error(); as message) {
            <p data-demo="openrouter-error" role="alert" class="text-nxa-destructive">
              {{ message }}
            </p>
          }
          <p class="text-xs text-nxa-muted-foreground">
            Free models allow about 50 requests a day per account, and 20 a minute.
          </p>
          <p class="text-xs text-nxa-muted-foreground">
            Model names and logos are trademarks of their owners. ngx-assistant is not affiliated
            with them. Logos from Lobe Icons (MIT).
          </p>
        </section>
      </ng-template>
    }
  `,
})
export class AccountRow {
  /** Where the row is: a full-width row at the bottom of the sidebar, or a button in the header. */
  readonly placement = input<AccountPlacement>('sidebar');

  protected readonly account = inject(OpenRouterAccount);
  protected readonly models = inject(DemoModels);
  protected readonly buttonClass = BUTTON;
  protected readonly menuPanel = `${MENU_PANEL} min-w-56`;
  protected readonly menuItem = MENU_ITEM;
  protected readonly menuItemDestructive = MENU_ITEM_DESTRUCTIVE;
  protected readonly keysPage = OPENROUTER_KEYS_PAGE;
  protected readonly logo = 'url("providers/openrouter.svg") center / contain no-repeat';

  protected readonly rowClass = computed(() =>
    this.placement() === 'sidebar' ? `${ROW} w-full px-2 py-1.5` : `${ROW} h-8 px-2`,
  );
  protected readonly positions = computed(() => (this.placement() === 'sidebar' ? ABOVE : BELOW));

  protected readonly open = signal(false);
  /** Made when the panel opens: each address carries a new PKCE verifier. */
  protected readonly signInUrl = signal<string | undefined>(undefined);
  protected readonly ready = computed(() => !!this.signInUrl() && !this.account.connecting());

  private readonly injector = inject(Injector);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly keyInput = viewChild<ElementRef<HTMLInputElement>>('keyInput');

  constructor() {
    // A sign-in that failed on the way back from OpenRouter says why, in the open panel: once, not
    // again each time the row is made (switching layouts).
    effect(() => {
      const error = this.account.error();
      if (!error || this.account.connected() || error === shownError) return;
      shownError = error;
      untracked(() => this.open.set(true));
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

  /** The focus goes into the panel when it opens, as into a dialog. */
  protected focusPanel() {
    queueMicrotask(() => this.panel()?.nativeElement.focus());
  }

  /** Disconnects; the focus goes to the "Sign in" row that takes the place of the account. */
  protected disconnect() {
    this.account.disconnect();
    this.open.set(false);
    this.focusTriggerAfterRender();
  }

  protected saveKey(event: Event) {
    event.preventDefault();
    const field = this.keyInput()?.nativeElement;
    if (!field?.value.trim()) return;
    this.account.useKey(field.value);
    field.value = '';
    this.open.set(false);
    // The account row takes the place of the "Sign in" row: the focus goes to it.
    this.focusTriggerAfterRender();
  }

  /** Focuses the row once it is rendered again, as the other row (signed in or out). */
  private focusTriggerAfterRender() {
    afterNextRender(() => this.trigger()?.nativeElement.focus(), { injector: this.injector });
  }

  /**
   * Escape closes the panel, back to the row that opened it. So does Tab past either end of the
   * panel: it sits at the end of the page, and the focus would leave it for the browser or the end
   * of the page instead of going on from the row.
   */
  protected onOverlayKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    const panel = this.panel()?.nativeElement;
    if (event.key !== 'Tab' || !panel) return;
    const focusable = [
      ...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input'),
    ];
    const active = panel.ownerDocument.activeElement;
    const atEdge = event.shiftKey
      ? active === panel || active === focusable[0]
      : active === focusable.at(-1);
    if (!atEdge) return;
    event.preventDefault();
    this.close();
  }

  /** A click outside the panel closes it; a click on the row toggles it instead. */
  protected onOutsideClick(event: MouseEvent) {
    const target = event.target as Node | null;
    if (target && this.trigger()?.nativeElement.contains(target)) return;
    this.open.set(false);
  }

  /** The panel closes when the focus moves out of it, as a popover does. */
  protected onPanelFocusOut(event: FocusEvent) {
    const next = event.relatedTarget as Node | null;
    if (next && !this.panel()?.nativeElement.contains(next)) this.open.set(false);
  }

  private close() {
    this.open.set(false);
    this.trigger()?.nativeElement.focus();
  }
}
