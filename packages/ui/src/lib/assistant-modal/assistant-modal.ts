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
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  NxaThreadListNew,
  NxaThreadListRoot,
  fromRuntime,
  injectNxaEvent,
  injectThreadList,
} from '@ngx-assistant/angular';
import { NxaIcon } from '../icons';
import { NxaThreadListItems, NxaThreadListSearch } from '../thread-list/thread-list';
import { UNTITLED_THREAD } from '../thread-list/thread-list-groups';
import { NxaThread } from '../thread/thread';
import { ModalSizeController } from './modal-size';

/** What the modal shows: the conversation, or the threads to pick from. */
export type AssistantModalView = 'thread' | 'list';

let nextId = 0;

const HEADER_BUTTON =
  'flex size-7 items-center justify-center rounded-md text-nxa-muted-foreground outline-none transition-colors hover:bg-nxa-accent hover:text-nxa-foreground focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-nxa-muted aria-pressed:text-nxa-foreground';

const ICON_SWAP =
  'absolute size-5 transition-[scale,opacity] duration-200 motion-reduce:transition-none';

/**
 * A floating chat: a round button fixed to the bottom corner on the end side opens a window above
 * it with the thread of the runtime, and a Threads view to pick another thread or start a new one.
 * The window opens by itself when a reply starts.
 *
 * The window is not modal, as a chat widget beside the page: a click outside leaves it open; the
 * button and Escape close it, and the focus goes back to the button. Its top corner on the start
 * side resizes it, with the pointer or the arrow keys; Enter or a double click restore the default
 * size. The size is remembered in `localStorage`. Elements marked `nxaComposerTools` go in the
 * composer of its thread.
 *
 * @example
 * ```html
 * <nxa-assistant-modal />
 * <nxa-assistant-modal>
 *   <nxa-model-selector nxaComposerTools variant="ghost" side="top" [models]="models" />
 * </nxa-assistant-modal>
 * ```
 */
@Component({
  selector: 'nxa-assistant-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CdkOverlayOrigin,
    CdkConnectedOverlay,
    NxaThread,
    NxaThreadListRoot,
    NxaThreadListNew,
    NxaThreadListSearch,
    NxaThreadListItems,
    NxaIcon,
  ],
  host: { class: 'fixed end-4 bottom-4 z-40 block size-11', 'data-slot': 'assistant-modal' },
  template: `
    <button
      type="button"
      cdkOverlayOrigin
      #origin="cdkOverlayOrigin"
      data-slot="assistant-modal-button"
      [attr.aria-label]="open() ? 'Close Assistant' : 'Open Assistant'"
      [attr.title]="open() ? 'Close Assistant' : 'Open Assistant'"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="open() ? dialogId : null"
      (click)="toggle()"
      class="relative flex size-full items-center justify-center rounded-full border border-nxa-border bg-nxa-background text-nxa-foreground shadow-md outline-none transition-[scale] duration-150 hover:bg-nxa-accent focus-visible:ring-2 focus-visible:ring-nxa-ring active:scale-95 motion-reduce:transition-none"
    >
      <nxa-icon
        name="bot"
        [class]="iconSwap"
        [class.scale-50]="open()"
        [class.opacity-0]="open()"
      />
      <nxa-icon
        name="chevron-down"
        [class]="iconSwap"
        [class.scale-50]="!open()"
        [class.opacity-0]="!open()"
      />
    </button>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayDisableClose]="true"
      (overlayKeydown)="onKeydown($event)"
      (detach)="open.set(false)"
    >
      <div
        #content
        role="dialog"
        [id]="dialogId"
        [attr.aria-labelledby]="titleId"
        data-slot="assistant-modal-content"
        [style.width.px]="sizer.size()?.width"
        [style.height.px]="sizer.size()?.height"
        class="group/modal relative flex h-[500px] max-h-[calc(100dvh-6rem)] w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-clip rounded-xl border border-nxa-border bg-nxa-background text-nxa-foreground shadow-xl transition-[opacity,translate] duration-200 starting:translate-y-2 starting:opacity-0 motion-reduce:transition-none"
      >
        <button
          type="button"
          aria-label="Resize Assistant"
          title="Resize Assistant"
          data-slot="assistant-modal-resize-handle"
          (pointerdown)="sizer.pointerDown($event)"
          (pointermove)="sizer.pointerMove($event)"
          (pointerup)="sizer.pointerUp($event)"
          (pointercancel)="sizer.pointerCancel($event)"
          (keydown)="sizer.keyDown($event)"
          (dblclick)="sizer.reset()"
          class="absolute start-0 top-0 z-10 size-6 cursor-nwse-resize touch-none rounded-ss-xl border-s-2 border-t-2 border-transparent outline-none transition-colors group-hover/modal:border-nxa-border hover:border-nxa-ring focus-visible:border-nxa-ring motion-reduce:transition-none rtl:cursor-nesw-resize"
        ></button>
        <div
          data-slot="assistant-modal-header"
          class="flex h-11 shrink-0 items-center gap-2 border-b border-nxa-border ps-3.5 pe-2"
        >
          <h2
            #heading
            [id]="titleId"
            tabindex="-1"
            data-slot="assistant-modal-title"
            class="min-w-0 flex-1 truncate text-[13px] font-medium outline-none"
          >
            {{ view() === 'list' ? 'Threads' : title() || untitled }}
          </h2>
          <div class="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              data-slot="assistant-modal-threads"
              aria-label="Threads"
              title="Threads"
              [attr.aria-pressed]="view() === 'list'"
              [disabled]="!hasThreads() && view() === 'thread'"
              (click)="view.set(view() === 'list' ? 'thread' : 'list')"
              [class]="headerButton"
            >
              <nxa-icon name="history" class="size-3.5" />
            </button>
            <button
              nxaThreadListNew
              data-slot="assistant-modal-new"
              aria-label="New Thread"
              title="New Thread"
              (click)="view.set('thread')"
              [class]="headerButton"
            >
              <nxa-icon name="plus" class="size-3.5" />
            </button>
          </div>
        </div>
        <div data-slot="assistant-modal-body" class="relative min-h-0 flex-1">
          <nxa-thread data-slot="assistant-modal-thread" class="h-full" [inert]="view() === 'list'">
            <ng-content select="[nxaComposerTools]" ngProjectAs="[nxaComposerTools]" />
          </nxa-thread>
          @if (view() === 'list') {
            <nav
              #list
              nxaThreadListRoot
              aria-label="Threads"
              data-slot="assistant-modal-thread-list"
              class="absolute inset-0 flex flex-col gap-0.5 overflow-y-auto bg-nxa-background p-2"
            >
              @if (hasThreads()) {
                <nxa-thread-list-search [(value)]="search" />
              }
              <nxa-thread-list-items [query]="hasThreads() ? search() : ''" />
            </nav>
          }
        </div>
      </div>
    </ng-template>
  `,
})
export class NxaAssistantModal {
  /** Whether the window is open. */
  readonly open = signal(false);
  /** What the window shows. */
  readonly view = signal<AssistantModalView>('thread');

  protected readonly dialogId = `nxa-assistant-modal-${nextId}`;
  protected readonly titleId = `nxa-assistant-modal-title-${nextId++}`;
  protected readonly untitled = UNTITLED_THREAD;
  protected readonly headerButton = HEADER_BUTTON;
  protected readonly iconSwap = ICON_SWAP;
  protected readonly search = signal('');
  /** Opens above the button, aligned to its end, 16 pixels away. */
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -16 },
  ];

  private readonly threads = injectThreadList();
  protected readonly title = fromRuntime(this.threads, (s) => s.threadItems[s.mainThreadId]?.title);
  protected readonly hasThreads = fromRuntime(this.threads, (s) => s.threadIds.length > 0);

  private readonly origin = viewChild.required('origin', { read: ElementRef<HTMLElement> });
  private readonly content = viewChild<ElementRef<HTMLElement>>('content');
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  protected readonly sizer = new ModalSizeController(() => this.content()?.nativeElement);

  private readonly mainThreadId = fromRuntime(this.threads, (s) => s.mainThreadId);
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  constructor() {
    // Picking a thread in the list, or starting one, shows it.
    let main = untracked(this.mainThreadId);
    effect(() => {
      const id = this.mainThreadId();
      if (id === main) return;
      main = id;
      untracked(() => this.view.set('thread'));
    });

    // Picking the thread already open switches nothing, but shows it too.
    effect((onCleanup) => {
      const list = this.list()?.nativeElement;
      if (!list) return;
      const onClick = (event: MouseEvent) => {
        const target = event.target as Element | null;
        if (target?.closest('[data-slot="thread-list-item-trigger"]')) this.view.set('thread');
      };
      list.addEventListener('click', onClick);
      onCleanup(() => list.removeEventListener('click', onClick));
    });

    injectNxaEvent('thread.runStart', () => {
      this.view.set('thread');
      this.open.set(true);
    });

    // A view change that leaves the focus nowhere puts it on the title.
    const injector = inject(Injector);
    let shown = untracked(this.view);
    effect(() => {
      const view = this.view();
      if (view === shown) return;
      shown = view;
      afterNextRender(
        () => {
          const heading = this.heading()?.nativeElement;
          const active = heading?.ownerDocument.activeElement;
          if (active === heading?.ownerDocument.body || active === this.content()?.nativeElement) {
            heading?.focus();
          }
        },
        { injector },
      );
    });
  }

  protected toggle() {
    if (this.open()) {
      this.close();
    } else {
      this.view.set('thread');
      this.open.set(true);
    }
  }

  /** Closes the window; the focus goes back to the button when it was inside. */
  close() {
    const content = this.content()?.nativeElement;
    const hadFocus = !!content && content.contains(content.ownerDocument.activeElement);
    this.open.set(false);
    if (hadFocus) this.origin().nativeElement.focus();
  }

  protected onKeydown(event: KeyboardEvent) {
    // A control that handles Escape itself (a menu, an edit) keeps it, and so does an open IME
    // composition (229 is what some browsers send then).
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    // The overlay hears the whole page: Escape in the page around the window is not for it.
    const content = this.content()?.nativeElement;
    if (!content || !content.contains(event.target as Node | null)) return;
    event.preventDefault();
    this.close();
  }
}
