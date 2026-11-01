import {
  EnvironmentInjector,
  createEnvironmentInjector,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { MessagePartRuntime, MessagePartState } from '@ngx-assistant/engine';
import { NXA_PART } from '../scopes';
import {
  TextStreamAnimator,
  injectSmoothText,
  type NxaSmooth,
  type NxaSmoothOptions,
} from './smooth-text';

type Status = MessagePartState['status'];
const COMPLETE: Status = { type: 'complete' };
const RUNNING: Status = { type: 'running' };

const textState = (text: string): MessagePartState =>
  ({ type: 'text', text, status: COMPLETE }) as MessagePartState;
const reasoningState = (text: string): MessagePartState =>
  ({ type: 'reasoning', text, status: COMPLETE }) as MessagePartState;
const runningState = (text: string): MessagePartState =>
  ({ type: 'text', text, status: RUNNING }) as MessagePartState;

/** A part runtime whose state the test sets. */
function fakePart(initial: MessagePartState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const runtime = {
    path: { messagePartSelector: { type: 'index', index: 0 } },
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as MessagePartRuntime;
  return {
    runtime,
    set(next: MessagePartState) {
      state = next;
      listeners.forEach((listener) => listener());
    },
  };
}

/** `injectSmoothText` over a fake part, with the effects flushed after every change. */
function setup(initial: MessagePartState, smooth: NxaSmooth = true) {
  const part = fakePart(initial);
  const option = signal<NxaSmooth>(smooth);
  const scope = createEnvironmentInjector(
    [{ provide: NXA_PART, useValue: part.runtime }],
    TestBed.inject(EnvironmentInjector),
  );
  const result = runInInjectionContext(scope, () => injectSmoothText(() => option()));
  TestBed.tick();
  return {
    result,
    rerender(next: MessagePartState) {
      part.set(next);
      TestBed.tick();
    },
    setSmooth(value: NxaSmooth) {
      option.set(value);
      TestBed.tick();
    },
    unmount: () => scope.destroy(),
  };
}

const setReducedMotion = (matches: boolean) => {
  const listeners = new Set<() => void>();
  const query = {
    matches,
    media: '',
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    set(value: boolean) {
      query.matches = value;
      listeners.forEach((listener) => listener());
    },
    listeners,
  };
};

/** Frames that run only when the test says so, and a clock that moves with them. */
function manualFrames(start = 1000) {
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  let now = start;
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id);
  });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  return {
    get queued() {
      return frames.size;
    },
    frame(step = 16) {
      now += step;
      const queued = [...frames.values()];
      frames.clear();
      queued.forEach((callback) => callback(now));
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('injectSmoothText', () => {
  const driveAndCount = (minCommitMs: number) => {
    const frames = manualFrames();
    const { result, unmount } = setup(runningState('0123456789'), {
      minCommitMs,
      maxCharsPerFrame: 1,
      maxCharIntervalMs: 1,
    });
    const seen = new Set<string>();
    let guard = 0;
    while (frames.queued > 0 && guard < 100) {
      guard++;
      frames.frame();
      seen.add(result().text);
    }
    const final = result().text;
    unmount();
    vi.restoreAllMocks();
    return { final, commits: seen.size };
  };

  it('starts no reveal for a settled part', () => {
    const start = vi.spyOn(TextStreamAnimator.prototype, 'start');
    const { result } = setup(textState('hello'));
    expect(result().text).toBe('hello');
    expect(start).not.toHaveBeenCalled();
  });

  it('shows the whole text at once where there are no animation frames', () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const { result } = setup(runningState('streaming'));
    expect(result().text).toBe('streaming');
  });

  it('returns the text of the part as it is when disabled', () => {
    const { result } = setup(runningState('hello'), false);
    expect(result()).toEqual({ text: 'hello', status: RUNNING });
  });

  it('returns the full text immediately for settled parts when enabled', () => {
    const { result } = setup(textState('hello'));
    expect(result()).toEqual({ text: 'hello', status: COMPLETE });
  });

  it('reveals reasoning parts too', () => {
    const { result } = setup(reasoningState('thinking...'));
    expect(result().text).toBe('thinking...');
  });

  it('needs a text or reasoning part', () => {
    expect(() =>
      setup({ type: 'image', image: 'x', status: COMPLETE } as unknown as MessagePartState),
    ).toThrow(/text or reasoning part, not a image part/);
  });

  it('tolerates null as disabled', () => {
    const { result } = setup(runningState('hello'), null);
    expect(result().text).toBe('hello');
  });

  it('disables the reveal under prefers-reduced-motion, live', () => {
    const media = setReducedMotion(true);
    manualFrames();
    const { result, unmount } = setup(runningState('streaming'));
    expect(result()).toEqual({ text: 'streaming', status: RUNNING });

    media.set(false);
    TestBed.tick();
    expect(result().text).toBe('streaming');

    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('starts from an empty reveal for running parts when enabled', () => {
    manualFrames();
    const { result } = setup(runningState('streaming'));
    expect(result()).toEqual({ text: '', status: RUNNING });
  });

  it.each([
    { name: 'negative drain time', options: { drainMs: -1 } },
    { name: 'NaN character interval', options: { maxCharIntervalMs: NaN } },
    { name: 'zero frame cap', options: { maxCharsPerFrame: 0 } },
  ])('uses the default timing for $name', ({ options }) => {
    const frames = manualFrames(0);
    const { result } = setup(runningState('hello'), options);
    expect(result().text).toBe('');
    frames.frame(16);
    expect(result().text).toBe('hel');
    frames.frame(16);
    expect(result().text).toBe('hello');
  });

  it('accepts an options object as the enabled form', () => {
    const options: NxaSmoothOptions = { drainMs: 500, maxCharsPerFrame: 30 };
    const { result } = setup(textState('hello'), options);
    expect(result()).toEqual({ text: 'hello', status: COMPLETE });
  });

  it('commits fewer times under minCommitMs without losing characters', () => {
    const everyFrame = driveAndCount(0);
    const floored = driveAndCount(50);
    expect(everyFrame.final).toBe('0123456789');
    expect(floored.final).toBe('0123456789');
    expect(floored.commits).toBeLessThan(everyFrame.commits);
  });

  it('commits the first frame after a discontinuity without waiting out minCommitMs', () => {
    const frames = manualFrames(0);
    const { result, rerender } = setup(runningState('aaaaaaaaaa'), {
      minCommitMs: 10000,
      maxCharsPerFrame: 1,
      maxCharIntervalMs: 1,
    });
    frames.frame();
    expect(result().text).toBe('a');
    frames.frame();
    expect(result().text).toBe('a');

    rerender(runningState('zzzzzzzzzz'));
    expect(result().text).toBe('');
    frames.frame();
    expect(result().text).toBe('z');
  });

  it('shows the completed text when a queued frame never runs', () => {
    vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const { result, rerender } = setup(runningState(''));
    rerender(runningState('hello'));
    rerender(textState('hello'));
    expect(result()).toEqual({ text: 'hello', status: COMPLETE });
  });

  it('keeps revealing after the part settles while frames come', () => {
    const frames = manualFrames();
    const { result, rerender } = setup(runningState('hello'), {
      maxCharsPerFrame: 1,
      maxCharIntervalMs: 1,
      drainMs: 250,
    });
    frames.frame();
    const mid = result().text;
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.length).toBeLessThan('hello'.length);
    expect(result().status.type).toBe('running');

    rerender(textState('hello'));
    expect(result()).toEqual({ text: mid, status: RUNNING });

    frames.frame();
    expect(result().text.length).toBeGreaterThan(mid.length);
    let guard = 0;
    while (result().text !== 'hello' && guard++ < 20) frames.frame();
    expect(result()).toEqual({ text: 'hello', status: COMPLETE });
  });

  it('shows what arrived when the run is cancelled mid-stream', () => {
    const frames = manualFrames();
    const { result, rerender } = setup(runningState('hel'), {
      maxCharsPerFrame: 1,
      maxCharIntervalMs: 1,
    });
    frames.frame();
    const cancelled = {
      type: 'text',
      text: 'hel',
      status: { type: 'incomplete', reason: 'cancelled' },
    } as MessagePartState;
    rerender(cancelled);
    let guard = 0;
    while (result().text !== 'hel' && guard++ < 20) frames.frame();
    expect(result()).toEqual({ text: 'hel', status: cancelled.status });
    expect(frames.queued).toBe(0);
  });

  it('snaps when a settled part replaces the text instead of looping the reveal', () => {
    const frames = manualFrames();
    const { result, rerender } = setup(runningState('hello world'), {
      maxCharsPerFrame: 1,
      maxCharIntervalMs: 1,
      drainMs: 250,
    });
    frames.frame();
    expect(result().text.length).toBeGreaterThan(0);

    rerender(textState('hi'));
    expect(result()).toEqual({ text: 'hi', status: COMPLETE });
    expect(frames.queued).toBe(0);
    frames.frame();
    expect(result().text).toBe('hi');
  });

  it('turning it off shows the text as it is and stops the frames; on again goes on from there', () => {
    const frames = manualFrames();
    const { result, rerender, setSmooth } = setup(runningState('hello world'), {
      maxCharsPerFrame: 1,
      maxCharIntervalMs: 1,
    });
    frames.frame();
    setSmooth(false);
    expect(result().text).toBe('hello world');
    expect(frames.queued).toBe(0);

    setSmooth({ maxCharsPerFrame: 1, maxCharIntervalMs: 1 });
    expect(result().text).toBe('hello world');
    rerender(runningState('hello world!!'));
    expect(result().text).toBe('hello world');
    frames.frame();
    expect(result().text).toBe('hello world!');
  });

  it('cancels the frame in progress when destroyed', () => {
    const frames = manualFrames();
    const { unmount } = setup(runningState('hello'), { maxCharsPerFrame: 1 });
    frames.frame();
    expect(frames.queued).toBe(1);
    unmount();
    expect(frames.queued).toBe(0);
  });
});
