import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  booleanAttribute,
  effect,
  inject,
  input,
} from '@angular/core';
import { NxaMessagePartByIndex, NxaReasoningGroup } from '@ngx-assistant/angular';
import { NxaIcon } from '../icons';
import { NxaMarkdownText } from './markdown-text';

/**
 * While `active`, keeps a scrollable box at its bottom as its content grows, until the user
 * scrolls up (by wheel, touch or keyboard); scrolling back to the bottom pins it again.
 */
@Directive({ selector: '[nxaPinToBottom]' })
export class NxaPinToBottom {
  readonly active = input(false, { alias: 'nxaPinToBottom', transform: booleanAttribute });

  constructor() {
    const box: HTMLElement = inject(ElementRef).nativeElement;
    let stop: (() => void) | null = null;
    effect((onCleanup) => {
      if (!this.active()) return;
      let pinned = true;
      let lastTop = box.scrollTop;
      let lastHeight = box.scrollHeight;
      const atBottom = () =>
        Math.abs(box.scrollHeight - box.scrollTop - box.clientHeight) <= 1 ||
        box.scrollHeight <= box.clientHeight;
      const pin = () => {
        if (pinned) box.scrollTop = box.scrollHeight;
      };
      // A pin's own scroll event can arrive after the content grew and read as "not at bottom":
      // only an upward move at an unchanged height is the user's.
      const onScroll = () => {
        if (atBottom()) pinned = true;
        else if (box.scrollTop < lastTop && box.scrollHeight === lastHeight) pinned = false;
        lastTop = box.scrollTop;
        lastHeight = box.scrollHeight;
      };
      // A wheel or touch moving up is the user's even while the content grows.
      const onWheel = (event: WheelEvent) => {
        if (event.deltaY < 0) pinned = false;
      };
      const onTouch = () => {
        pinned = false;
      };
      pin();
      box.addEventListener('scroll', onScroll);
      box.addEventListener('wheel', onWheel, { passive: true });
      box.addEventListener('touchmove', onTouch, { passive: true });
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(pin);
      for (const child of box.children) observer?.observe(child);
      stop = () => {
        box.removeEventListener('scroll', onScroll);
        box.removeEventListener('wheel', onWheel);
        box.removeEventListener('touchmove', onTouch);
        observer?.disconnect();
      };
      onCleanup(() => stop?.());
    });
    inject(DestroyRef).onDestroy(() => stop?.());
  }
}

let nextId = 0;

/**
 * A run of consecutive reasoning parts in one disclosure: open while the model reasons, closed
 * once it is done, and toggled by the user from then on. Render it for every reasoning part:
 * only the first part of a run shows it.
 */
@Component({
  selector: 'nxa-reasoning',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaReasoningGroup, NxaMessagePartByIndex, NxaMarkdownText, NxaIcon, NxaPinToBottom],
  template: `
    <div
      *nxaReasoningGroup="let group"
      data-slot="reasoning-root"
      [attr.data-state]="group.open() ? 'open' : 'closed'"
      class="mb-4 w-full rounded-lg border border-nxa-border px-3 py-1.5"
    >
      <button
        type="button"
        data-slot="reasoning-trigger"
        [attr.data-state]="group.open() ? 'open' : 'closed'"
        [attr.aria-expanded]="group.open()"
        [attr.aria-controls]="contentId"
        class="group/trigger flex items-center gap-2 rounded-md py-1.5 text-sm text-nxa-muted-foreground transition-colors outline-none hover:text-nxa-foreground focus-visible:ring-2 focus-visible:ring-nxa-ring"
        (click)="group.toggle()"
      >
        <nxa-icon name="sparkle" class="size-4" />
        <span [class.animate-pulse]="group.streaming()" class="motion-reduce:animate-none"
          >Reasoning</span
        >
        <nxa-icon
          name="chevron-down"
          class="size-4 -rotate-90 transition-transform duration-200 group-data-[state=open]/trigger:rotate-0 motion-reduce:transition-none"
        />
      </button>
      @if (group.open()) {
        <div
          data-slot="reasoning-content"
          [id]="contentId"
          [attr.aria-busy]="group.streaming() ? 'true' : null"
          class="relative text-sm text-nxa-muted-foreground"
        >
          <div
            data-slot="reasoning-text"
            [nxaPinToBottom]="group.streaming()"
            class="max-h-64 overflow-y-auto py-2 ps-6"
          >
            <div>
              @for (index of group.indices(); track index) {
                <nxa-markdown-text *nxaMessagePartByIndex="index" class="mb-2 last:mb-0" />
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class NxaReasoning {
  protected readonly contentId = `nxa-reasoning-${nextId++}`;
}
