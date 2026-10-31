/** One chunk of a UI message stream, as AI SDK's `toUIMessageStreamResponse()` sends it. */
export type UIMessageChunk = { readonly type: string } & Record<string, unknown>;

/** Writes one chunk; throws once the client has gone, which ends the reply. */
export type WriteChunk = (chunk: UIMessageChunk) => void;

const CLIENT_GONE = Symbol('client gone');
const encoder = new TextEncoder();

/** Resolves after `ms`, or throws when the client goes away in the meantime. */
export type Pause = (ms: number) => Promise<void>;

/**
 * A streaming response in the UI message stream protocol: server-sent events with one JSON chunk
 * each, closed by `[DONE]`. `produce` writes the chunks; it stops when the request is aborted,
 * which fails the body, or when the client cancels the body, as a server stops writing to a closed
 * connection.
 */
export function uiMessageStreamResponse(
  produce: (write: WriteChunk, pause: Pause) => Promise<void>,
  signal: AbortSignal | null | undefined,
): Response {
  let gone = false;
  const isGone = () => gone || signal?.aborted === true;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (data: string) => controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      const write: WriteChunk = (chunk) => {
        if (isGone()) throw CLIENT_GONE;
        send(JSON.stringify(chunk));
      };
      const pause: Pause = async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
        if (isGone()) throw CLIENT_GONE;
      };
      // An aborted request fails its body, as `fetch` does over the network.
      const onAbort = () => {
        if (gone) return;
        gone = true;
        controller.error(new DOMException('The request was aborted.', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const end = (close: () => void) => {
        signal?.removeEventListener('abort', onAbort);
        if (isGone()) return;
        gone = true;
        close();
      };
      void produce(write, pause).then(
        () =>
          end(() => {
            send('[DONE]');
            controller.close();
          }),
        (error: unknown) => {
          if (error !== CLIENT_GONE) end(() => controller.error(error));
        },
      );
    },
    cancel() {
      gone = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'x-vercel-ai-ui-message-stream': 'v1',
    },
  });
}

let nextPartId = 0;

/** Streams `text` as one text part, a word at a time. */
export async function writeText(write: WriteChunk, pause: Pause, text: string, delayMs: number) {
  const id = `text-${++nextPartId}`;
  write({ type: 'text-start', id });
  const words = text.split(' ').filter(Boolean);
  for (const [index, word] of words.entries()) {
    await pause(delayMs);
    write({ type: 'text-delta', id, delta: index === 0 ? word : ` ${word}` });
  }
  write({ type: 'text-end', id });
}

/** Writes `text` as one reasoning part. */
export function writeReasoning(write: WriteChunk, text: string) {
  const id = `reasoning-${++nextPartId}`;
  write({ type: 'reasoning-start', id });
  write({ type: 'reasoning-delta', id, delta: text });
  write({ type: 'reasoning-end', id });
}
