import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  booleanAttribute,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import type { ThreadState } from '@ngx-assistant/engine';
import {
  NxaComposerIf,
  NxaMessageRoot,
  NxaMessages,
  NxaScrollToBottom,
  NxaThreadEmpty,
  NxaThreadRoot,
  NxaThreadViewport,
  NxaThreadViewportFooter,
  fromRuntime,
  injectComposer,
  injectThread,
} from '@ngx-assistant/angular';
import { NxaIcon } from '../icons';
import { NxaTooltip } from '../tooltip/tooltip';
import { NxaAssistantMessage } from './assistant-message';
import { NxaComposer } from './composer';
import { NxaEditComposer } from './edit-composer';
import { NxaFocusKeeper } from './focus-keeper';
import { NxaThreadSuggestions } from './thread-suggestions';
import { NxaThreadWelcome } from './thread-welcome';
import { NxaUserMessage } from './user-message';

/**
 * A complete chat thread on the runtime provided above it: the welcome screen with suggestions
 * while it is empty, the messages (each user message turns into its edit form while edited), a
 * viewport that follows the reply as it streams, a button back to the bottom, and the composer.
 *
 * With `welcomeLayout="centered"` (the default) an empty thread puts the composer in the middle,
 * under the greeting, with the suggestions below it while the field is empty; the first message
 * moves the composer to the bottom (a short slide, unless the user asks for reduced motion).
 * `welcomeLayout="bottom"` keeps the composer at the bottom, with the greeting and suggestion cards
 * in the middle. The composer is the same element in every layout: the draft, the attachments and
 * the focus stay when the layout changes.
 *
 * Fill a container with a height: the thread takes all of it and scrolls inside. Elements marked
 * `nxaComposerTools` go in the composer, after the attachment button, and elements marked
 * `nxaComposerNotice` above the composer field (a usage limit, a hint to sign in).
 *
 * @example
 * ```html
 * <nxa-thread class="h-dvh" />
 * <nxa-thread class="h-dvh">
 *   <nxa-model-selector nxaComposerTools variant="ghost" side="top" [models]="models" />
 * </nxa-thread>
 * ```
 */
@Component({
  selector: 'nxa-thread',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaThreadRoot,
    NxaThreadViewport,
    NxaThreadViewportFooter,
    NxaScrollToBottom,
    NxaThreadEmpty,
    NxaMessages,
    NxaMessageRoot,
    NxaComposerIf,
    NxaFocusKeeper,
    NxaThreadWelcome,
    NxaThreadSuggestions,
    NxaUserMessage,
    NxaAssistantMessage,
    NxaEditComposer,
    NxaComposer,
    NxaIcon,
    NxaTooltip,
  ],
  host: { class: 'flex min-h-0 flex-col bg-nxa-background text-nxa-foreground' },
  template: `
    <div
      nxaThreadRoot
      nxaFocusKeeper
      [attr.data-welcome-layout]="welcomeLayout()"
      [attr.data-empty]="empty() ? '' : null"
      class="flex min-h-0 flex-1 flex-col [--nxa-thread-max-width:44rem]"
    >
      <div
        nxaThreadViewport
        data-slot="thread-viewport"
        class="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        <div
          class="mx-auto flex w-full max-w-(--nxa-thread-max-width) flex-1 flex-col px-4 pt-6"
          [class.justify-center]="centered()"
        >
          @if (welcomeLayout() === 'bottom') {
            <nxa-thread-welcome *nxaThreadEmpty [title]="welcome()">
              <nxa-thread-suggestions variant="grid" />
            </nxa-thread-welcome>
          } @else {
            <nxa-thread-welcome *nxaThreadEmpty align="start" [title]="welcome()" />
          }

          <div data-slot="thread-messages" class="mb-6 flex flex-col gap-6 empty:hidden">
            <div
              *nxaMessages="let message"
              nxaMessageRoot
              [attr.data-role]="message().role"
              class="flex flex-col"
            >
              <nxa-edit-composer *nxaComposerIf="{ editing: true }; else view" />
              <ng-template #view>
                @if (message().role === 'user') {
                  <nxa-user-message />
                } @else {
                  <nxa-assistant-message />
                }
              </ng-template>
            </div>
          </div>

          <div
            #footer
            nxaThreadViewportFooter
            data-slot="thread-viewport-footer"
            class="flex flex-col items-center gap-3 bg-nxa-background pb-4"
            [class]="centered() ? 'relative' : 'sticky bottom-0 mt-auto'"
          >
            <button
              nxaScrollToBottom
              behavior="smooth"
              aria-label="Scroll to bottom"
              nxaTooltip="Scroll to bottom"
              class="absolute -top-11 flex size-8 items-center justify-center rounded-full border border-nxa-border bg-nxa-background shadow-sm transition-[opacity,scale] duration-150 outline-none hover:bg-nxa-accent motion-safe:active:scale-90 focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:invisible disabled:opacity-0"
            >
              <nxa-icon name="arrow-down" class="size-4" />
            </button>
            <nxa-composer class="w-full" [autoFocus]="autoFocus()">
              <ng-content select="[nxaComposerTools]" ngProjectAs="[nxaComposerTools]" />
              <ng-content select="[nxaComposerNotice]" ngProjectAs="[nxaComposerNotice]" />
            </nxa-composer>
            @if (centered() && composerEmpty()) {
              <nxa-thread-suggestions class="mt-1" />
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class NxaThread {
  /** Whether the composer takes the focus (on by default, as a chat page expects). */
  readonly autoFocus = input(true, { transform: booleanAttribute });
  /** The greeting of the empty thread. */
  readonly welcome = input('How can I help you today?');
  /** Where the composer of an empty thread goes (see the class description). */
  readonly welcomeLayout = input<'centered' | 'bottom'>('centered');

  private readonly footer = viewChild<ElementRef<HTMLElement>>('footer');
  private readonly injector = inject(Injector);

  protected readonly empty = fromRuntime(injectThread(), isEmpty);
  protected readonly composerEmpty = fromRuntime(injectComposer(), (s) => s.isEmpty);
  /** The composer sits in the middle, under the greeting. */
  protected readonly centered = computed(() => this.welcomeLayout() === 'centered' && this.empty());

  constructor() {
    this.slideComposerDownOnFirstMessage();
  }

  /**
   * When a message fills a centered empty thread, the composer jumps from the middle to the bottom:
   * slide it there instead. The thread state changes before Angular renders, so the composer is
   * measured in the old layout when the state changes and in the new one after the next render.
   * Opening another thread with its messages is no send, and does not slide.
   */
  private slideComposerDownOnFirstMessage() {
    const thread = injectThread();
    let previous = thread.getState();
    const unsubscribe = thread.subscribe(() => {
      const state = thread.getState();
      const started = isEmpty(previous) && !isEmpty(state) && previous.threadId === state.threadId;
      previous = state;
      if (!started || this.welcomeLayout() !== 'centered' || !isSend(state)) return;
      const footer = this.footer()?.nativeElement;
      if (!footer || typeof footer.animate !== 'function' || prefersReducedMotion()) return;
      const before = footer.getBoundingClientRect().top;
      afterNextRender(
        {
          read: () => {
            const offset = before - footer.getBoundingClientRect().top;
            if (Math.abs(offset) < 1) return;
            footer.animate([{ translate: `0 ${offset}px` }, { translate: '0 0' }], {
              duration: 250,
              easing: 'cubic-bezier(0.2, 0, 0, 1)',
            });
          },
        },
        { injector: this.injector },
      );
    });
    inject(DestroyRef).onDestroy(unsubscribe);
  }
}

/** The thread has no messages and is not loading them (as `*nxaThreadEmpty`). */
const isEmpty = (s: ThreadState) => s.messages.length === 0 && !s.isLoading;

/** The first messages come from a send (the user's message, or a run), not from opening a thread. */
const isSend = (s: ThreadState) => s.isRunning || s.messages.at(-1)?.role === 'user';

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
