export const REPLAY_CONTENT_LENGTH_HEADER = 'Nxa-Replay-Content-Length';

interface ReplayBoundaryStreamOptions {
  setReplaying: (value: boolean) => void;
  waitForRender: () => Promise<void>;
}

/**
 * Waits until the thread has shown the latest state: each wait asks for a render after the
 * current task and resolves once `rendered` reports it. `dispose` resolves every wait, now and
 * later, since nothing will render any more.
 */
export class RenderWait {
  private waiters: (() => void)[] = [];
  private disposed = false;

  constructor(private readonly requestRender: () => void) {}

  wait = (): Promise<void> =>
    new Promise<void>((resolve) => {
      setTimeout(() => {
        if (this.disposed) {
          resolve();
          return;
        }
        this.waiters.push(resolve);
        this.requestRender();
      }, 0);
    });

  rendered(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  dispose(): void {
    this.disposed = true;
    this.rendered();
  }
}

const parseReplayContentLength = (headers: Headers): number => {
  const raw = headers.get(REPLAY_CONTENT_LENGTH_HEADER);
  if (raw == null) return 0;

  const boundary = Number(raw);
  return Number.isSafeInteger(boundary) && boundary > 0 ? boundary : 0;
};

// Gates replay bytes until isReplaying:true renders, then releases live bytes after isReplaying:false renders.
export const createReplayBoundaryStream = async (
  response: Response,
  { setReplaying, waitForRender: waitForReplayRender }: ReplayBoundaryStreamOptions,
): Promise<ReadableStream<Uint8Array>> => {
  const body = response.body as ReadableStream<Uint8Array>;
  const replayContentLength = parseReplayContentLength(response.headers);

  if (replayContentLength <= 0) {
    return body;
  }

  setReplaying(true);
  await waitForReplayRender();

  const reader = body.getReader();
  let bytesForwarded = 0;
  let replayFinished = false;
  let replayCleared = false;
  let readerCleanup: Promise<void> | undefined;

  const clearReplay = () => {
    if (replayCleared) return;
    replayCleared = true;
    setReplaying(false);
  };

  const releaseReader = () => {
    if (readerCleanup) return readerCleanup;
    reader.releaseLock();
    readerCleanup = Promise.resolve();
    return readerCleanup;
  };

  const cancelReader = (reason?: unknown) => {
    if (readerCleanup) return readerCleanup;
    readerCleanup = (async () => {
      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
      }
    })();
    return readerCleanup;
  };

  const finishReplay = async () => {
    if (replayFinished) return;
    replayFinished = true;

    // Let replay bytes drain before rendering live mode, then render live mode before releasing live bytes.
    await waitForReplayRender();
    clearReplay();
    await waitForReplayRender();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          await releaseReader();
          await finishReplay();
          controller.close();
          return;
        }

        if (replayFinished) {
          controller.enqueue(value);
          return;
        }

        const nextBytesForwarded = bytesForwarded + value.byteLength;

        if (nextBytesForwarded < replayContentLength) {
          bytesForwarded = nextBytesForwarded;
          controller.enqueue(value);
          return;
        }

        if (nextBytesForwarded === replayContentLength) {
          controller.enqueue(value);
          await finishReplay();
          return;
        }

        const replayBytesInChunk = replayContentLength - bytesForwarded;

        controller.enqueue(value.subarray(0, replayBytesInChunk));
        await finishReplay();
        controller.enqueue(value.subarray(replayBytesInChunk));
      } catch (error) {
        clearReplay();
        await cancelReader(error).catch(() => undefined);
        throw error;
      }
    },
    async cancel(reason) {
      const wasFinished = replayFinished;
      replayFinished = true;
      if (!wasFinished) clearReplay();
      await cancelReader(reason);
    },
  });
};
