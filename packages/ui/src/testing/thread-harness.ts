import { ChangeDetectionStrategy, Component, computed, signal, type Provider } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideExternalStoreRuntime } from '@ngx-assistant/angular';
import type { ExternalStoreAdapter, ThreadMessageLike } from '@ngx-assistant/engine';
import { NxaThread } from '../lib/thread/thread';

/** Options of {@link mountThread}. */
export interface MountOptions {
  isRunning?: boolean;
  adapter?: Partial<ExternalStoreAdapter<ThreadMessageLike>>;
  autoFocus?: boolean;
  providers?: Provider[];
}

/**
 * Mounts `<nxa-thread>` on an external store runtime over `messages`. `update` replaces the
 * messages (and the running flag) as a host app would.
 */
export async function mountThread(
  messages: readonly ThreadMessageLike[],
  options: MountOptions = {},
) {
  const store = signal({ messages, isRunning: options.isRunning });
  const provider = provideExternalStoreRuntime<ThreadMessageLike>(() =>
    computed((): ExternalStoreAdapter<ThreadMessageLike> => {
      const { messages: current, isRunning } = store();
      return {
        messages: [...current],
        convertMessage: (message) => message,
        onNew: async () => undefined,
        ...(isRunning === undefined ? {} : { isRunning }),
        ...options.adapter,
      };
    }),
  );

  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [NxaThread],
    providers: [provider, ...(options.providers ?? [])],
    template: `<nxa-thread [autoFocus]="autoFocus" />`,
  })
  class Host {
    protected readonly autoFocus = options.autoFocus ?? true;
  }

  const fixture = TestBed.createComponent(Host);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    el,
    update: (next: readonly ThreadMessageLike[], nextOptions: { isRunning?: boolean } = {}) =>
      store.set({ messages: next, isRunning: nextOptions.isRunning }),
  };
}

/** Waits until `assert` passes, letting Angular render in between. */
export const settle = (fixture: ComponentFixture<unknown>, assert: () => void) =>
  vi.waitFor(async () => {
    await fixture.whenStable();
    assert();
  });

export const rows = (root: ParentNode) => [
  ...root.querySelectorAll<HTMLElement>('[data-nxa-message-id][data-role]'),
];

export const buttons = (root: ParentNode) => [
  ...root.querySelectorAll<HTMLButtonElement>('button'),
];

/** The button whose text is `label`. */
export const button = (root: ParentNode, label: string) => {
  const match = buttons(root).find((item) => item.textContent?.trim() === label);
  if (!match) throw new Error(`no "${label}" button`);
  return match;
};

export const slot = <T extends HTMLElement = HTMLElement>(root: ParentNode, name: string) =>
  root.querySelector<T>(`[data-slot="${name}"]`);

export const type = (field: HTMLTextAreaElement, value: string) => {
  field.value = value;
  field.dispatchEvent(new Event('input'));
};

/** The thread viewport, made scrollable for jsdom, which applies no stylesheet. */
export const scrollableViewport = (root: ParentNode) => {
  const viewport = slot(root, 'thread-viewport')!;
  viewport.style.overflowY = 'auto';
  return viewport;
};

/** jsdom has no ResizeObserver. */
export function stubResizeObserver() {
  globalThis.ResizeObserver ??= class {
    observe() {
      // No layout in jsdom: nothing ever resizes.
    }
    unobserve() {
      // Nothing observed.
    }
    disconnect() {
      // Nothing observed.
    }
  } as unknown as typeof ResizeObserver;
}
