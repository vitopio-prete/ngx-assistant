import {
  createAssistantStream,
  DataStreamDecoder,
  UIMessageStreamDecoder,
  type AssistantStream,
} from 'assistant-stream';
import { resolveDataStreamProtocol, type DataStreamProtocol } from '../data-stream/protocol';

export type { AssistantStream } from 'assistant-stream';

/**
 * A stream that carries a title already known, for the `generateTitle` of a
 * `RemoteThreadListAdapter` whose backend answers with the title in one piece.
 *
 * ```ts
 * async generateTitle(remoteId, messages) {
 *   const { title } = await (await fetch(`/api/threads/${remoteId}/title`, ...)).json();
 *   return titleStream(title);
 * }
 * ```
 */
export function titleStream(title: string): AssistantStream {
  return createAssistantStream((controller) => {
    controller.appendText(title);
  });
}

export interface TitleStreamFromResponseOptions {
  /** Defaults to the protocol header of the response, then `'ui-message-stream'`. */
  protocol?: DataStreamProtocol | undefined;
}

/**
 * Reads the title a backend streams back, in the UI message stream or data stream format, for the
 * `generateTitle` of a `RemoteThreadListAdapter`. The text of the reply is the title.
 *
 * ```ts
 * async generateTitle(remoteId, messages) {
 *   return titleStreamFromResponse(await fetch(`/api/threads/${remoteId}/title`, ...));
 * }
 * ```
 *
 * Rejects when the response is not ok or has no body.
 */
export async function titleStreamFromResponse(
  response: Response,
  options: TitleStreamFromResponseOptions = {},
): Promise<AssistantStream> {
  if (!response.ok) {
    throw new Error(`Status ${response.status}: ${await response.text()}`);
  }
  if (!response.body) throw new Error('Response body is null');

  const { protocol } = resolveDataStreamProtocol(response.headers, options.protocol);
  return response.body.pipeThrough(
    protocol === 'ui-message-stream' ? new UIMessageStreamDecoder() : new DataStreamDecoder(),
  );
}
