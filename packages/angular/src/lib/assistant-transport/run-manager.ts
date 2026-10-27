import { invokeUserCallback, raceWithAbortSignal } from '@ngx-assistant/engine';

const disposeReason = Symbol('assistant-transport-dispose');

type LifecycleCallbackName = 'onCancel' | 'onError' | 'onFinish';

const invokeCallback = (name: LifecycleCallbackName, callback: (() => unknown) | undefined) =>
  invokeUserCallback('ngx-assistant', `Assistant transport ${name}`, callback);

export interface RunManagerCallbacks {
  onRun: (signal: AbortSignal) => Promise<void>;
  onFinish?: (() => void) | undefined;
  /** `afterError` is set for a cancel that arrived while `onError` was pending. */
  onCancel?: ((afterError?: boolean) => void) | undefined;
  onError?: ((error: Error) => void | Promise<void>) | undefined;
  /** Called when `isRunning` changes. */
  onRunningChange?: (() => void) | undefined;
}

/**
 * Runs one request at a time. A schedule while a run is active coalesces into a single follow-up
 * run, started right after the active one settles. Runs start in a microtask, so schedules in the
 * same task share one run. `dispose` aborts the active run without calling any callback.
 */
export class RunManager {
  private _isRunning = false;
  private pending = false;
  private disposed = false;
  private abortController: AbortController | null = null;

  constructor(private readonly callbacks: RunManagerCallbacks) {}

  get isRunning(): boolean {
    return this._isRunning;
  }

  schedule(): void {
    if (this.disposed) return;
    if (this.abortController) {
      this.pending = true;
      return;
    }
    this.startRun();
  }

  /** Aborts the active run and drops a scheduled follow-up; returns whether a run was active. */
  cancel(): boolean {
    this.pending = false;
    const ac = this.abortController;
    ac?.abort();
    return ac !== null;
  }

  dispose(): void {
    this.disposed = true;
    this.pending = false;
    this.abortController?.abort(disposeReason);
  }

  private setRunning(isRunning: boolean) {
    if (this._isRunning === isRunning) return;
    this._isRunning = isRunning;
    this.callbacks.onRunningChange?.();
  }

  private startRun() {
    this.setRunning(true);
    this.pending = false;
    const ac = new AbortController();
    this.abortController = ac;
    const live = () => !this.disposed;
    const { callbacks } = this;

    queueMicrotask(async () => {
      try {
        if (ac.signal.aborted) throw ac.signal.reason;
        if (live()) {
          await callbacks.onRun(ac.signal);
          // A fully received body is not errored by abort(), so a cancelled run can still resolve.
          if (ac.signal.aborted) throw ac.signal.reason;
        }
      } catch (error) {
        if (live()) {
          if (ac.signal.aborted) {
            void invokeCallback('onCancel', callbacks.onCancel);
          } else {
            this.pending = false;
            await raceWithAbortSignal(ac.signal, async () =>
              invokeCallback('onError', () => callbacks.onError?.(error as Error)),
            ).catch(() => undefined);
            if (ac.signal.aborted && live()) {
              void invokeCallback('onCancel', () => callbacks.onCancel?.(true));
            }
          }
        }
      } finally {
        if (live()) void invokeCallback('onFinish', callbacks.onFinish);
        if (live() && this.pending) {
          this.startRun();
        } else {
          if (this.abortController === ac) this.abortController = null;
          this.setRunning(false);
        }
      }
    });
  }
}
