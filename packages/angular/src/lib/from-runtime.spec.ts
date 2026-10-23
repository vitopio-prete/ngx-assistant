import {
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  Injector,
  computed,
  createEnvironmentInjector,
  effect,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fromRuntime, type RuntimeSubscribable } from './from-runtime';

interface State {
  selected: number;
  text: string;
}

/** Minimal runtime: a state snapshot replaced on every update, plus counted subscriptions. */
class FakeRuntime implements RuntimeSubscribable<State> {
  private state: State = { selected: 0, text: '' };
  private readonly listeners = new Set<() => void>();
  subscriptions = 0;
  releases = 0;

  getState() {
    return this.state;
  }

  subscribe(callback: () => void) {
    this.subscriptions++;
    this.listeners.add(callback);
    return () => {
      this.releases++;
      this.listeners.delete(callback);
    };
  }

  update(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
}

const childInjector = () => createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));

/** Runs `read` in an effect owned by `injector` and records each value it produces. */
const track = <T>(injector: Injector, read: () => T) => {
  const values: T[] = [];
  effect(() => void values.push(read()), { injector });
  TestBed.tick();
  return values;
};

describe('fromRuntime', () => {
  it('tracks a signal reached after an equal runtime selection', () => {
    const runtime = new FakeRuntime();
    const index = signal(0);
    const injector = childInjector();
    const selected = fromRuntime(runtime, (s) => s.selected === 1 && index() === 1, { injector });

    expect(selected()).toBe(false);
    runtime.update({ selected: 1 });
    expect(selected()).toBe(false);
    expect(runtime.subscriptions).toBe(1);

    index.set(1);
    expect(selected()).toBe(true);
    expect(runtime.subscriptions).toBe(1);

    injector.destroy();
    expect(runtime.releases).toBe(1);
  });

  it('updates the rendered selection after a selector signal changes', async () => {
    const runtime = new FakeRuntime();

    @Component({
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: `<output>{{ selected() ? 'selected' : 'not selected' }}</output>`,
    })
    class SelectorProbe {
      readonly index = signal(0);
      readonly selected = fromRuntime(runtime, (s) => s.selected === this.index());
    }

    const fixture = TestBed.createComponent(SelectorProbe);
    const output = () =>
      (fixture.nativeElement as HTMLElement).querySelector('output')!.textContent;
    await fixture.whenStable();
    expect(output()).toBe('selected');

    fixture.componentInstance.index.set(1);
    await fixture.whenStable();
    expect(output()).toBe('not selected');

    runtime.update({ selected: 1 });
    await fixture.whenStable();
    expect(output()).toBe('selected');

    fixture.destroy();
    expect(runtime.releases).toBe(1);
  });

  it('deduplicates against the latest selection', () => {
    const runtime = new FakeRuntime();
    const input = signal(0);
    const injector = childInjector();
    const selected = fromRuntime(runtime, (s) => s.selected === input(), { injector });
    const values = track(injector, selected);
    expect(values).toEqual([true]);

    input.set(1);
    TestBed.tick();
    expect(values).toEqual([true, false]);

    runtime.update({ text: 'unrelated' });
    TestBed.tick();
    expect(values).toEqual([true, false]);

    runtime.update({ selected: 1 });
    TestBed.tick();
    expect(values).toEqual([true, false, true]);
    injector.destroy();
  });

  it('tracks the selected slice inside an effect', () => {
    const runtime = new FakeRuntime();
    const injector = childInjector();
    const values = track(
      injector,
      fromRuntime(runtime, (s) => s.selected, { injector }),
    );
    expect(values).toEqual([0]);

    runtime.update({ selected: 3 });
    TestBed.tick();
    expect(values).toEqual([0, 3]);
    injector.destroy();
  });

  it('stops tracking after destroy and keeps the last value', () => {
    const runtime = new FakeRuntime();
    const input = signal(0);
    const selector = vi.fn((s: State) => s.selected === input());
    const injector = childInjector();
    const selected = fromRuntime(runtime, selector, { injector });
    expect(selected()).toBe(true);

    injector.destroy();
    expect(runtime.releases).toBe(1);
    const reads = selector.mock.calls.length;

    input.set(1);
    expect(selected()).toBe(true);
    runtime.update({ selected: 1 });
    expect(selected()).toBe(true);
    expect(selector).toHaveBeenCalledTimes(reads);
  });

  it('surfaces selector errors and recovers when selector signals change', () => {
    const runtime = new FakeRuntime();
    const unavailable = signal(false);
    const injector = childInjector();
    const selected = fromRuntime(
      runtime,
      (s) => {
        if (unavailable()) throw new Error('unavailable');
        return s.selected;
      },
      { injector },
    );
    const values = track(injector, () => {
      try {
        return selected();
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(values).toEqual([0]);

    unavailable.set(true);
    TestBed.tick();
    expect(values).toEqual([0, 'unavailable']);

    unavailable.set(false);
    TestBed.tick();
    expect(values).toEqual([0, 'unavailable', 0]);
    injector.destroy();
  });

  it('does not wake an effect when an unrelated slice changes', () => {
    const runtime = new FakeRuntime();
    const injector = childInjector();
    const values = track(
      injector,
      fromRuntime(runtime, (s) => s.selected, { injector }),
    );
    expect(values).toHaveLength(1);

    // The runtime notifies, but the selected slice is unchanged, so the effect must not re-run
    runtime.update({ text: 'draft' });
    TestBed.tick();
    expect(values).toHaveLength(1);

    runtime.update({ selected: 1 });
    TestBed.tick();
    expect(values).toHaveLength(2);
    injector.destroy();
  });

  it('reads the current value outside effects', () => {
    const runtime = new FakeRuntime();
    const injector = childInjector();
    const selected = fromRuntime(runtime, (s) => s.selected, { injector });

    expect(selected()).toBe(0);
    runtime.update({ selected: 5 });
    expect(selected()).toBe(5);
    injector.destroy();
  });

  it('returns the whole state snapshot without a selector', () => {
    const runtime = new FakeRuntime();
    const injector = childInjector();
    const state = fromRuntime(runtime, undefined, { injector });

    expect(state()).toBe(runtime.getState());
    runtime.update({ text: 'draft' });
    expect(state()).toEqual({ selected: 0, text: 'draft' });
    injector.destroy();
  });

  it('uses a custom equality to skip notifications', () => {
    const runtime = new FakeRuntime();
    const injector = childInjector();
    const values = track(
      injector,
      fromRuntime(runtime, (s) => ({ selected: s.selected }), {
        injector,
        equal: (a, b) => a.selected === b.selected,
      }),
    );

    runtime.update({ text: 'draft' });
    TestBed.tick();
    expect(values).toEqual([{ selected: 0 }]);

    runtime.update({ selected: 2 });
    TestBed.tick();
    expect(values).toEqual([{ selected: 0 }, { selected: 2 }]);
    injector.destroy();
  });

  it('rejects a runtime change made inside a computed', () => {
    const runtime = new FakeRuntime();
    const injector = childInjector();
    const selected = fromRuntime(runtime, (s) => s.selected, { injector });
    const changesRuntime = computed(() => runtime.update({ selected: 1 }));

    expect(() => changesRuntime()).toThrow(/NG0600/);
    expect(selected()).toBe(1);
    injector.destroy();
  });

  it('subscribes nothing through a destroyed component injector', () => {
    @Component({ changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
    class Empty {}

    const fixture = TestBed.createComponent(Empty);
    const injector = fixture.componentRef.injector;
    fixture.destroy();
    const runtime = new FakeRuntime();

    expect(() => fromRuntime(runtime, undefined, { injector })).toThrow(/NG0911/);
    expect(runtime.subscriptions).toBe(0);
  });

  it('requires an injection context or an injector', () => {
    expect(() => fromRuntime(new FakeRuntime(), (s) => s.selected)).toThrow(/NG0203/);
  });
});
