import type {
  ThreadRuntimeCore,
  ThreadRuntimeEventType,
} from "../../runtime/interfaces/thread-runtime-core";
import type {
  ThreadListRuntimeCore,
  ThreadListRuntimeEvent,
} from "../../runtime/interfaces/thread-list-runtime-core";
import type { Unsubscribe } from "../../types/unsubscribe";
import {
  BaseSubscribable,
  notifySubscribers,
  runCleanups,
  SKIP_UPDATE,
  ShallowMemoizeSubject,
} from "../../subscribable/subscribable";
import {
  getThreadRuntimeCoreIsRunning,
  type ThreadRuntimeImpl,
} from "../../runtime/api/thread-runtime";
import { ThreadListItemRuntimeImpl } from "../../runtime/api/thread-list-item-runtime";
import {
  disposeThreadRuntime,
  supersedeThreadRuntime,
} from "../../runtime/utils/thread-runtime-lifecycle";
import { notifyEventListeners } from "../../utils/notify-event-listeners";
import { ThreadListDestroyedError } from "./thread-list-destroyed";
import type { RuntimeAdapters } from "./types";
import type {
  RemoteThreadRuntimeFactory,
  RemoteThreadRuntimeHandle,
} from "./thread-runtime-factory";

const THREAD_EVENTS = [
  "runStart",
  "runEnd",
  "initialize",
  "modelContextUpdate",
] as const satisfies readonly ThreadRuntimeEventType[];

type MountedThread = {
  generation: number;
  dispose: () => void;
};

type RemoteThreadInstance = {
  runtime?: ThreadRuntimeCore | undefined;
  publishedGeneration?: number | undefined;
  mountedGeneration?: number | undefined;
  mountError?: { error: unknown } | undefined;
  generation: number;
  isRunning: boolean;
  unsubscribeRunning?: Unsubscribe | undefined;
  // Permanent teardown of the thread's runtime, aborted when the thread is
  // stopped or its runtime restarted.
  destroy: AbortController;
  mounted?: MountedThread | undefined;
  // Runtimes of earlier generations, kept until the next one is created so a
  // send made on them in between still lands.
  retired?: MountedThread[] | undefined;
};

const isRuntimeAttached = (
  instance: RemoteThreadInstance | undefined,
): instance is RemoteThreadInstance & {
  runtime: ThreadRuntimeCore;
} =>
  instance?.runtime !== undefined &&
  instance.mountError === undefined &&
  instance.publishedGeneration === instance.generation;

const unmount = (mounted: MountedThread | undefined) => {
  if (!mounted) return;
  try {
    mounted.dispose();
  } catch (error) {
    console.error(
      "[ngx-assistant] Thread runtime cleanup threw while stopping a thread",
      error,
    );
  }
};

type ThreadCoreBindings = {
  __internal_setGetThreadId?: (getThreadId: () => string | undefined) => void;
  __internal_setGetInitializePromise?: (
    getInitializePromise: () => Promise<unknown> | undefined,
  ) => void;
};

/**
 * Runs the runtime of each started thread of a remote thread list. Each start
 * calls the factory once, in a microtask, and publishes the main thread core
 * of the runtime it returns; stopping or restarting the thread disposes it.
 */
export class RemoteThreadInstanceManager extends BaseSubscribable {
  private threadRuntime: RemoteThreadRuntimeFactory;
  private defaultAdapters: RuntimeAdapters | null = null;
  private instances = new Map<string, RemoteThreadInstance>();
  private nextGeneration = 0;
  private disposed = false;
  private parent: ThreadListRuntimeCore;

  constructor(
    threadRuntime: RemoteThreadRuntimeFactory,
    parent: ThreadListRuntimeCore,
  ) {
    super();
    this.parent = parent;
    this.threadRuntime = threadRuntime;
  }

  private _whenRuntimeAttached(threadId: string) {
    return new Promise<ThreadRuntimeCore>((resolve, reject) => {
      const callback = () => {
        const instance = this.instances.get(threadId);
        if (!instance) {
          dispose();
          reject(new Error("Thread was deleted before runtime was started"));
        } else if (instance.mountError) {
          dispose();
          reject(instance.mountError.error);
        } else if (isRuntimeAttached(instance)) {
          dispose();
          resolve(instance.runtime);
        }
      };
      const dispose = this.subscribe(callback);
      callback();
    });
  }

  public startThreadRuntime(threadId: string) {
    if (this.disposed) return Promise.reject(new ThreadListDestroyedError());
    const existing = this.instances.get(threadId);
    if (existing?.mountError && !isRuntimeAttached(existing)) {
      // A failed creation is retried by the next start.
      this._retireThreadRuntime(existing);
      this._remount(threadId, existing);
    } else if (!existing) {
      const generation = this.nextGeneration++;
      this.instances.set(threadId, {
        generation,
        isRunning: false,
        destroy: new AbortController(),
      });
      this._scheduleMount(threadId, generation);
    }

    return this._whenRuntimeAttached(threadId);
  }

  private _retireThreadRuntime(instance: RemoteThreadInstance) {
    // Detach before superseding and aborting: teardown can synchronously emit
    // terminal events that must not reach subscribers for the next generation.
    try {
      instance.unsubscribeRunning?.();
    } finally {
      instance.unsubscribeRunning = undefined;
      if (instance.runtime) supersedeThreadRuntime(instance.runtime);
      instance.destroy.abort();
      instance.destroy = new AbortController();
      instance.generation = this.nextGeneration++;
      instance.mountError = undefined;
    }
  }

  private _remount(threadId: string, instance: RemoteThreadInstance) {
    if (instance.mounted) {
      (instance.retired ??= []).push(instance.mounted);
      instance.mounted = undefined;
    }
    this._scheduleMount(threadId, instance.generation);
  }

  private _unmountRetired(instance: RemoteThreadInstance) {
    const retired = instance.retired ?? [];
    instance.retired = undefined;
    for (const mounted of retired) unmount(mounted);
  }

  public __internal_restartThreadRuntime(threadId: string) {
    const instance = this.instances.get(threadId);
    if (!instance) return this.startThreadRuntime(threadId);

    try {
      this._retireThreadRuntime(instance);
    } finally {
      this._notifySubscribers();
      this._remount(threadId, instance);
    }

    return this._whenRuntimeAttached(threadId);
  }

  public getThreadRuntimeCore(threadId: string) {
    const instance = this.instances.get(threadId);
    if (!instance) return undefined;
    return instance.runtime;
  }

  public __internal_hasThreadRuntime(threadId: string) {
    return this.instances.has(threadId);
  }

  public __internal_isThreadRuntimeAttached(threadId: string) {
    return isRuntimeAttached(this.instances.get(threadId));
  }

  public __internal_isThreadRunning(threadId: string) {
    return this.instances.get(threadId)?.isRunning ?? false;
  }

  private runningSubscribers = new Set<() => void>();

  public __internal_subscribeRunningChanged(callback: () => void): Unsubscribe {
    this.runningSubscribers.add(callback);
    return () => this.runningSubscribers.delete(callback);
  }

  private threadEventSubscribers = new Set<
    (event: ThreadListRuntimeEvent) => void
  >();

  public __internal_subscribeThreadEvents(
    callback: (event: ThreadListRuntimeEvent) => void,
  ): Unsubscribe {
    this.threadEventSubscribers.add(callback);
    return () => this.threadEventSubscribers.delete(callback);
  }

  private _failThreadRuntime(
    threadId: string,
    generation: number,
    error: unknown,
  ) {
    const instance = this.instances.get(threadId);
    if (
      instance?.generation !== generation ||
      (isRuntimeAttached(instance) && instance.mountedGeneration === generation)
    )
      return;
    instance.mountError = { error };
    queueMicrotask(() => this._notifySubscribers());
  }

  private _publishThreadRuntime(
    threadId: string,
    runtime: ThreadRuntimeCore,
    generation: number,
  ) {
    const instance = this.instances.get(threadId);
    if (!instance) return;

    if (instance.generation !== generation) return;

    const previousRuntime = instance.runtime;
    const previousPublishedGeneration = instance.publishedGeneration;
    instance.mountError = undefined;
    instance.runtime = runtime;
    instance.publishedGeneration = generation;
    try {
      if (previousRuntime !== runtime) {
        this._trackRunning(threadId, instance);
      }
    } finally {
      try {
        this._notifySubscribers();
        if (previousRuntime !== undefined && previousRuntime !== runtime) {
          notifySubscribers(this.replacedSubscribers);
        }
      } finally {
        if (
          previousPublishedGeneration === generation &&
          previousRuntime !== undefined &&
          previousRuntime !== runtime
        ) {
          disposeThreadRuntime(previousRuntime);
        }
      }
    }
  }

  private replacedSubscribers = new Set<() => void>();

  public __internal_subscribeRuntimeReplaced(
    callback: () => void,
  ): Unsubscribe {
    this.replacedSubscribers.add(callback);
    return () => this.replacedSubscribers.delete(callback);
  }

  private _trackRunning(threadId: string, instance: RemoteThreadInstance) {
    const previousCleanup = instance.unsubscribeRunning;
    instance.unsubscribeRunning = undefined;
    try {
      previousCleanup?.();
    } finally {
      const runtime = instance.runtime;
      if (!runtime) {
        this._setRunning(instance, false);
      } else {
        // A publish can run while a subscriber of the list is notified, where
        // a synchronous notify would re-enter it.
        const isRunning = getThreadRuntimeCoreIsRunning(runtime);
        if (instance.isRunning !== isRunning) {
          instance.isRunning = isRunning;
          queueMicrotask(() => notifySubscribers(this.runningSubscribers));
        }
        const unsubscribers = [
          runtime.subscribe(() => {
            this._setRunning(instance, getThreadRuntimeCoreIsRunning(runtime));
          }),
          ...THREAD_EVENTS.map((type) =>
            runtime.unstable_on(type, () => {
              notifyEventListeners(
                this.threadEventSubscribers,
                { threadId, type },
                `Thread event "${type}"`,
              );
            }),
          ),
        ];
        instance.unsubscribeRunning = () => runCleanups(unsubscribers);
      }
    }
  }

  private _setRunning(instance: RemoteThreadInstance, isRunning: boolean) {
    if (instance.isRunning === isRunning) return;
    instance.isRunning = isRunning;
    notifySubscribers(this.runningSubscribers);
  }

  public stopThreadRuntime(threadId: string) {
    const instance = this.instances.get(threadId);
    try {
      instance?.unsubscribeRunning?.();
    } finally {
      try {
        if (instance?.runtime) disposeThreadRuntime(instance.runtime);
        instance?.destroy.abort();
        this.instances.delete(threadId);
        this._notifySubscribers();
      } finally {
        if (instance) {
          const mounted = instance.mounted;
          instance.mounted = undefined;
          try {
            unmount(mounted);
          } finally {
            this._unmountRetired(instance);
          }
        }
      }
    }
  }

  public setThreadRuntime(threadRuntime: RemoteThreadRuntimeFactory) {
    if (this.threadRuntime === threadRuntime) return;
    this.threadRuntime = threadRuntime;
    const entries = Array.from(this.instances.entries());
    try {
      runCleanups(
        entries.map(
          ([, instance]) =>
            () =>
              this._retireThreadRuntime(instance),
        ),
      );
    } finally {
      for (const [threadId, instance] of entries)
        this._remount(threadId, instance);
    }
  }

  public __internal_setDefaultAdapters(adapters: RuntimeAdapters | null) {
    this.defaultAdapters = adapters;
  }

  public __internal_dispose() {
    this.disposed = true;
    for (const threadId of [...this.instances.keys()]) {
      try {
        this.stopThreadRuntime(threadId);
      } catch (error) {
        console.error(
          "[ngx-assistant] Thread runtime cleanup threw while stopping a thread",
          error,
        );
      }
    }
  }

  // The factory runs in a microtask: a start stopped in the same task never
  // creates a runtime, and a factory is never called from inside the list's
  // own constructor or mutation.
  private _scheduleMount(threadId: string, generation: number) {
    queueMicrotask(() => {
      const instance = this.instances.get(threadId);
      if (
        this.disposed ||
        instance?.generation !== generation ||
        instance.mounted !== undefined
      )
        return;
      this._mount(threadId, instance);
    });
  }

  private _createItemRuntime(threadId: string) {
    const parentList = this.parent;
    return new ThreadListItemRuntimeImpl(
      new ShallowMemoizeSubject({
        path: {
          ref: `threadItems[threadId=${threadId}]`,
          threadSelector: { type: "threadId", threadId },
        },
        getState: () => {
          const data = parentList.getItemById(threadId);
          if (!data) return SKIP_UPDATE;
          return {
            id: data.id,
            remoteId: data.remoteId,
            externalId: data.externalId,
            title: data.title,
            lastMessageAt: data.lastMessageAt,
            custom: data.custom,
            status: data.status,
            isMain: data.id === parentList.mainThreadId,
            isRunning: parentList.unstable_isThreadRunning?.(data.id) ?? false,
          };
        },
        subscribe: (callback) => parentList.subscribe(callback),
      }),
      parentList,
    );
  }

  private _mount(threadId: string, instance: RemoteThreadInstance) {
    try {
      this._mountGeneration(threadId, instance);
    } finally {
      // The previous generation's runtime goes once its successor exists.
      this._unmountRetired(instance);
    }
  }

  private _mountGeneration(threadId: string, instance: RemoteThreadInstance) {
    const generation = instance.generation;
    let item: ThreadListItemRuntimeImpl;
    let handle: RemoteThreadRuntimeHandle;
    try {
      item = this._createItemRuntime(threadId);
      handle = this.threadRuntime({
        threadId,
        item,
        adapters: this.defaultAdapters ?? {},
        signal: instance.destroy.signal,
      });
    } catch (error) {
      this._failThreadRuntime(threadId, generation, error);
      return;
    }

    const cleanups: (() => void)[] = [];
    const mounted: MountedThread = {
      generation,
      dispose: () => {
        try {
          runCleanups(cleanups);
        } finally {
          handle.dispose();
        }
      },
    };
    instance.mounted = mounted;

    try {
      cleanups.push(...this._bind(threadId, generation, item, handle));
      if (this.instances.get(threadId) === instance) {
        instance.mountedGeneration = generation;
      }
    } catch (error) {
      this._failThreadRuntime(threadId, generation, error);
    }
  }

  // Publishes the runtime's main thread core and ties its first send to the
  // initialization of the list item, which gives the thread its remote id.
  private _bind(
    threadId: string,
    generation: number,
    item: ThreadListItemRuntimeImpl,
    { runtime }: RemoteThreadRuntimeHandle,
  ): Unsubscribe[] {
    const threadBinding = (runtime?.thread as ThreadRuntimeImpl | undefined)
      ?.__internal_threadBinding;
    // A runtime without a thread binding never attaches, so the start waits
    // until the thread is stopped.
    if (!threadBinding) return [];

    let remoteId: string | undefined;
    let initPromise: Promise<unknown> | undefined;
    let hasInitialized = false;
    // Any caller's initialize() moves the item off "new"; a thread born "new"
    // here still joins that initialization so its first send waits for it.
    let bornNew = item.getState().status === "new";

    const handleInitialize = () => {
      if (hasInitialized) return;

      if (item.getState().status !== "new" && !bornNew) return;
      hasInitialized = true;
      bornNew = false;

      const promise = item.initialize();
      initPromise = promise;
      void promise.then(
        (response) => {
          remoteId = response.remoteId;
        },
        () => {
          if (initPromise === promise) {
            initPromise = undefined;
            hasInitialized = false;
          }
        },
      );
    };

    const getInitializePromise = () => {
      handleInitialize();
      return initPromise;
    };

    let boundCore: ThreadRuntimeCore | undefined;
    const publish = () => {
      const core = threadBinding.getState();
      if (core !== boundCore) {
        boundCore = core;
        // A run reads the id right after the initialization barrier, before
        // the list item may show the remote id.
        const bindings = core as ThreadCoreBindings;
        bindings.__internal_setGetThreadId?.(
          () => remoteId ?? item.getState().remoteId,
        );
        bindings.__internal_setGetInitializePromise?.(getInitializePromise);
      }
      this._publishThreadRuntime(threadId, core, generation);
    };

    publish();
    const cleanups = [threadBinding.outerSubscribe(publish)];
    const main = runtime.threads?.main;
    if (main) cleanups.push(main.unstable_on("initialize", handleInitialize));
    return cleanups;
  }
}
