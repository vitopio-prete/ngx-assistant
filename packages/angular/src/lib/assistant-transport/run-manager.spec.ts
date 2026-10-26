import { CommandQueue } from './command-queue';
import { RunManager } from './run-manager';
import type { AssistantTransportCommand } from './types';

const createMessageCommand = (id: string): AssistantTransportCommand => ({
  type: 'add-message',
  message: { role: 'user', parts: [{ type: 'text', text: id }] },
  parentId: null,
  sourceId: null,
});

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const rejectOnAbort = (signal: AbortSignal, onAbort?: () => void) =>
  new Promise<void>((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        onAbort?.();
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

const captureUnhandledRejections = async (callback: () => Promise<void>): Promise<unknown[]> => {
  const reasons: unknown[] = [];
  const listener = (event: PromiseRejectionEvent) => reasons.push(event.reason);
  window.addEventListener('unhandledrejection', listener);
  try {
    await callback();
    await flushMicrotasks();
    return reasons;
  } finally {
    window.removeEventListener('unhandledrejection', listener);
  }
};

const createHarness = (
  opts: {
    onRun?: (signal: AbortSignal) => Promise<void> | void;
    onCancel?: (commands: AssistantTransportCommand[]) => void;
    onError?: (commands: AssistantTransportCommand[]) => void | Promise<void>;
    onFinish?: () => void;
  } = {},
) => {
  const runBatches: AssistantTransportCommand[][] = [];
  const runManager: RunManager = new RunManager({
    onRun: async (signal) => {
      runBatches.push(commandQueue.flush());
      await opts.onRun?.(signal);
    },
    onCancel: () => {
      const commands = [...commandQueue.state.inTransit, ...commandQueue.state.queued];
      commandQueue.reset();
      opts.onCancel?.(commands);
    },
    onError: async () => {
      await opts.onError?.([...commandQueue.state.inTransit]);
    },
    onFinish: () => opts.onFinish?.(),
  });
  const commandQueue = new CommandQueue({ onQueue: () => runManager.schedule() });
  return { commandQueue, runManager, runBatches };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('assistant transport scheduling contracts', () => {
  it('runs in single-flight mode and schedules exactly one follow-up run', async () => {
    const gate = createDeferred();
    const { commandQueue, runBatches } = createHarness({ onRun: () => gate.promise });

    commandQueue.enqueue(createMessageCommand('m1'));
    commandQueue.enqueue(createMessageCommand('m2'));

    await vi.waitFor(() => expect(runBatches).toHaveLength(1));
    expect(runBatches[0]).toHaveLength(2);

    commandQueue.enqueue(createMessageCommand('m3'));
    await Promise.resolve();
    expect(runBatches).toHaveLength(1);

    gate.resolve();

    await vi.waitFor(() => expect(runBatches).toHaveLength(2));
    expect(runBatches[1]).toHaveLength(1);
  });

  it('can enqueue without scheduling until a run is started', async () => {
    const { commandQueue, runManager, runBatches } = createHarness();

    commandQueue.enqueue(createMessageCommand('staged'), { schedule: false });
    await Promise.resolve();
    expect(runBatches).toHaveLength(0);

    runManager.schedule();

    await vi.waitFor(() => expect(runBatches).toHaveLength(1));
    expect(runBatches[0]).toHaveLength(1);
  });

  it('onError receives the live in-transit commands at error time', async () => {
    const seen: AssistantTransportCommand[][] = [];
    const { commandQueue } = createHarness({
      onRun: () => {
        throw new Error('network error');
      },
      onError: (commands) => {
        seen.push(commands);
      },
    });

    commandQueue.enqueue(createMessageCommand('m1'));

    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual([createMessageCommand('m1')]);
  });

  it('reports isRunning while a run is active, including its follow-up', async () => {
    const gate = createDeferred();
    const changes: boolean[] = [];
    const runManager: RunManager = new RunManager({
      onRun: () => gate.promise,
      onRunningChange: () => changes.push(runManager.isRunning),
    });

    runManager.schedule();
    expect(runManager.isRunning).toBe(true);
    runManager.schedule();
    gate.resolve();

    await vi.waitFor(() => expect(runManager.isRunning).toBe(false));
    expect(changes).toEqual([true, false]);
  });

  it('settles the run when onFinish throws', async () => {
    const error = new Error('telemetry failed');
    const onFinish = vi.fn<() => void>().mockImplementationOnce(() => {
      throw error;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { commandQueue, runManager, runBatches } = createHarness({ onFinish });

    commandQueue.enqueue(createMessageCommand('m1'));
    await vi.waitFor(() => expect(runManager.isRunning).toBe(false));

    commandQueue.enqueue(createMessageCommand('m2'));
    await vi.waitFor(() => expect(runBatches).toHaveLength(2));
    expect(consoleError).toHaveBeenCalledWith(
      '[ngx-assistant] Assistant transport onFinish callback threw an error',
      error,
    );
  });

  it('contains rejected onError callbacks', async () => {
    const callbackError = new Error('error telemetry failed');
    const onError = vi.fn().mockRejectedValue(callbackError);
    const consoleError = vi.spyOn(console, 'error').mockImplementation((message) => {
      if (message === '[ngx-assistant] Assistant transport onError callback threw an error') {
        throw new Error('console unavailable');
      }
    });

    const unhandledRejections = await captureUnhandledRejections(async () => {
      const { commandQueue, runManager } = createHarness({
        onRun: () => Promise.reject(new Error('network failed')),
        onError,
      });
      commandQueue.enqueue(createMessageCommand('m1'));
      await vi.waitFor(() => expect(runManager.isRunning).toBe(false));
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      '[ngx-assistant] Assistant transport onError callback threw an error',
      callbackError,
    );
    expect(unhandledRejections).toEqual([]);
  });

  it('contains throwing onCancel callbacks', async () => {
    const callbackError = new Error('cancel telemetry failed');
    const onCancel = vi.fn().mockImplementation(() => {
      throw callbackError;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const unhandledRejections = await captureUnhandledRejections(async () => {
      const { commandQueue, runManager, runBatches } = createHarness({
        onRun: (signal) => rejectOnAbort(signal),
        onCancel,
      });
      commandQueue.enqueue(createMessageCommand('m1'));
      await vi.waitFor(() => expect(runBatches).toHaveLength(1));

      runManager.cancel();
      await vi.waitFor(() => expect(runManager.isRunning).toBe(false));
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(
      '[ngx-assistant] Assistant transport onCancel callback threw an error',
      callbackError,
    );
    expect(unhandledRejections).toEqual([]);
  });

  it('cancel returns combined in-flight and queued commands', async () => {
    const onCancel = vi.fn();
    const { commandQueue, runManager, runBatches } = createHarness({
      onRun: (signal) => rejectOnAbort(signal),
      onCancel,
    });

    commandQueue.enqueue(createMessageCommand('in-flight'));
    await vi.waitFor(() => expect(runBatches).toHaveLength(1));

    commandQueue.enqueue(createMessageCommand('queued'));
    expect(runManager.cancel()).toBe(true);

    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(onCancel.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('cancel reports that no run was active', () => {
    const { runManager } = createHarness();
    expect(runManager.cancel()).toBe(false);
  });

  it('dispose aborts the in-flight run without invoking callbacks', async () => {
    let aborted = false;
    const onCancel = vi.fn();
    const onError = vi.fn();
    const onFinish = vi.fn();
    const { commandQueue, runManager, runBatches } = createHarness({
      onRun: (signal) =>
        rejectOnAbort(signal, () => {
          aborted = true;
        }),
      onCancel,
      onError,
      onFinish,
    });

    commandQueue.enqueue(createMessageCommand('in-flight'));
    await vi.waitFor(() => expect(runBatches).toHaveLength(1));

    runManager.dispose();
    await flushMicrotasks();

    expect(aborted).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('starts no run once disposed', async () => {
    const onRun = vi.fn(() => new Promise<void>(() => undefined));
    const onFinish = vi.fn();
    const { commandQueue, runManager } = createHarness({ onRun, onFinish });

    commandQueue.enqueue(createMessageCommand('late'));
    runManager.dispose();

    await flushMicrotasks();
    expect(onRun).not.toHaveBeenCalled();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('ignores schedules after dispose', async () => {
    const { commandQueue, runManager, runBatches } = createHarness();

    runManager.dispose();
    commandQueue.enqueue(createMessageCommand('late'));

    await flushMicrotasks();
    expect(runBatches).toHaveLength(0);
    expect(runManager.isRunning).toBe(false);
  });
});

describe('CommandQueue', () => {
  it('moves the queued commands in transit on flush and clears them on delivery', () => {
    const onChange = vi.fn();
    const queue = new CommandQueue({ onQueue: () => undefined, onChange });

    queue.enqueue(createMessageCommand('a'));
    queue.enqueue(createMessageCommand('b'));
    expect(queue.flush()).toEqual([createMessageCommand('a'), createMessageCommand('b')]);
    queue.enqueue(createMessageCommand('c'));
    expect(queue.state).toEqual({
      queued: [createMessageCommand('c')],
      inTransit: [createMessageCommand('a'), createMessageCommand('b')],
    });

    queue.markDelivered();
    expect(queue.state).toEqual({ queued: [createMessageCommand('c')], inTransit: [] });
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  it('flushes nothing, and changes nothing, when the queue is empty', () => {
    const onChange = vi.fn();
    const queue = new CommandQueue({ onQueue: () => undefined, onChange });
    const before = queue.state;

    expect(queue.flush()).toEqual([]);
    expect(queue.state).toBe(before);
    expect(onChange).not.toHaveBeenCalled();
  });
});
