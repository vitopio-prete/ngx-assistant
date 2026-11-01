import type { Provider, Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideLocalRuntime, provideRemoteThreadListRuntime } from '@ngx-assistant/angular';
import type {
  ChatModelAdapter,
  RemoteThreadListAdapter,
  RemoteThreadMetadata,
} from '@ngx-assistant/engine';

/** A thread of {@link makeAdapter}: regular unless `status` says otherwise. */
export interface ThreadFixture {
  remoteId: string;
  title?: string | undefined;
  lastMessageAt?: Date | undefined;
  status?: 'regular' | 'archived';
}

const emptyStream = () =>
  new ReadableStream({
    start(controller) {
      controller.close();
    },
  }) as never;

/** A remote thread list adapter over fixed threads, whose methods are spies. */
export const makeAdapter = (
  threads: readonly ThreadFixture[],
  overrides: Partial<RemoteThreadListAdapter> = {},
): RemoteThreadListAdapter => ({
  list: vi.fn(async () => ({
    threads: threads.map((thread): RemoteThreadMetadata => ({
      ...thread,
      status: thread.status ?? 'regular',
    })),
  })),
  initialize: vi.fn(async (threadId: string) => ({ remoteId: `remote-${threadId}` })),
  rename: vi.fn(async () => undefined),
  archive: vi.fn(async () => undefined),
  unarchive: vi.fn(async () => undefined),
  delete: vi.fn(async () => undefined),
  generateTitle: vi.fn(async () => emptyStream()),
  fetch: vi.fn(async (remoteId: string) => ({ status: 'regular' as const, remoteId })),
  ...overrides,
});

/** Threads `t0`, `t1`... with the given titles. */
export const withTitles = (...titles: string[]): ThreadFixture[] =>
  titles.map((title, index) => ({ remoteId: `t${index}`, title }));

/** A model that answers every message with `text`. */
export const replyModel = (text = 'Hello'): ChatModelAdapter => ({
  async *run() {
    yield { content: [{ type: 'text', text }] };
  },
});

/**
 * Mounts `component` on a remote thread list runtime over `adapter`, each thread running a local
 * runtime on `model`.
 */
export async function mountWithThreads<T>(
  adapter: RemoteThreadListAdapter,
  component: Type<T>,
  options: { model?: ChatModelAdapter; providers?: Provider[] } = {},
) {
  const model = options.model ?? replyModel();
  TestBed.configureTestingModule({
    providers: [
      provideRemoteThreadListRuntime({ adapter, runtime: () => provideLocalRuntime(model) }),
      ...(options.providers ?? []),
    ],
  });
  const fixture = TestBed.createComponent(component);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

/** The elements with `data-slot="<name>"` under `root`. */
export const slots = (root: ParentNode, name: string) => [
  ...root.querySelectorAll<HTMLElement>(`[data-slot="${name}"]`),
];

/** The trimmed texts of {@link slots}. */
export const texts = (root: ParentNode, name: string) =>
  slots(root, name).map((node) => node.textContent?.trim());

/** Types `value` into an input as a user would. */
export const typeInto = (input: HTMLInputElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

/** Dispatches a cancelable `keydown` and returns it. */
export const keydown = (target: Element, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...init });
  target.dispatchEvent(event);
  return event;
};

/** Waits until `assert` passes, letting Angular render in between. */
export const until = (fixture: ComponentFixture<unknown>, assert: () => void) =>
  vi.waitFor(async () => {
    await fixture.whenStable();
    assert();
  });
