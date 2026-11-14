import type { ChatRequest, Message } from './chat';
import { OPENROUTER_PREFIX, openRouterModels, type Network } from './openrouter-models';
import { uiMessageStreamResponse, type WriteChunk } from './ui-message-stream';
import { forecastFor } from './weather';

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** How many model calls one reply may take: each `get_weather` result needs one more. */
const MAX_STEPS = 4;

const SYSTEM =
  'You are the assistant of the ngx-assistant demo, a chat UI library for Angular. Answer briefly. ' +
  'For the weather, call get_weather. To send an email, call send_email: the user approves it first.';

/** The tools the backend gives a model that takes tools: as for the simulated models. */
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'The current weather in a city.',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_email',
      description: 'Sends an email, once the user approves it.',
      parameters: {
        type: 'object',
        properties: { to: { type: 'string' }, subject: { type: 'string' } },
        required: ['to', 'subject'],
      },
    },
  },
];

type OpenAIContent =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: OpenAIContent[] }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAIToolCall[];
      reasoning_details?: unknown[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

interface Capabilities {
  tools: boolean;
  images: boolean;
}

/** The conversation the client posted, as OpenAI-compatible messages for OpenRouter. */
export function toOpenAIMessages(
  system: string | undefined,
  messages: readonly Message[],
  { tools, images }: Capabilities,
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [
    { role: 'system', content: system ? `${SYSTEM}\n\n${system}` : SYSTEM },
  ];
  for (const message of messages) {
    if (message.role === 'system') {
      result.push({ role: 'system', content: message.content });
    } else if (message.role === 'user') {
      const content = message.content.flatMap((part): OpenAIContent[] => {
        if (part.type === 'text') return [{ type: 'text', text: part.text }];
        if (part.type !== 'file') return [];
        const name = part.filename ?? 'a file';
        if (images && part.mediaType.startsWith('image/') && typeof part.data === 'string') {
          return [{ type: 'image_url', image_url: { url: part.data } }];
        }
        return [{ type: 'text', text: `[${name} is attached, but this model cannot read it]` }];
      });
      if (content.length) result.push({ role: 'user', content });
    } else if (message.role === 'assistant') {
      const text = message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
      // A model without tools gets the text only: some providers refuse tool calls without tools.
      const calls = tools
        ? message.content.flatMap((part): OpenAIToolCall[] =>
            part.type === 'tool-call'
              ? [
                  {
                    id: part.toolCallId,
                    type: 'function',
                    function: { name: part.toolName, arguments: JSON.stringify(part.input ?? {}) },
                  },
                ]
              : [],
          )
        : [];
      if (!text && !calls.length) continue;
      result.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length ? { tool_calls: calls } : {}),
      });
    } else if (tools) {
      for (const part of message.content) {
        if (part.type !== 'tool-result') continue;
        result.push({
          role: 'tool',
          tool_call_id: part.toolCallId,
          content: JSON.stringify(part.output.value ?? null),
        });
      }
    }
  }
  return result;
}

/** What OpenRouter streams: OpenAI-compatible chunks, or an error. */
interface StreamChunk {
  error?: { message?: string; code?: number | string };
  choices?: {
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_details?: unknown[];
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
}

/** Reads the server-sent events of a response, one `data:` payload at a time, until `[DONE]`. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  const parse = (line: string) => {
    // Lines starting with ':' are comments OpenRouter sends to keep the connection open.
    if (!line.startsWith('data:')) return undefined;
    return line.slice('data:'.length).trim();
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        finished = true;
        // The last line may come without its newline.
        const data = parse((buffer + decoder.decode()).replace(/\r$/, ''));
        if (data && data !== '[DONE]') yield data;
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const data = parse(buffer.slice(0, end).replace(/\r$/, ''));
        buffer = buffer.slice(end + 1);
        if (data === '[DONE]') return;
        if (data) yield data;
      }
    }
  } finally {
    // Leaving early (an error, `[DONE]`, the client gone) stops the stream from OpenRouter too.
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Why OpenRouter refused a request, from its JSON error when it sent one. */
async function refusal(response: Response): Promise<string> {
  const body = await response.text();
  try {
    const message = (JSON.parse(body) as StreamChunk).error?.message;
    if (message) return `OpenRouter: ${message}`;
  } catch {
    // Not JSON: the text says it.
  }
  return `OpenRouter: ${body || response.statusText || 'request failed'}`;
}

/** Ids that stay unique across reloads, as the conversations do. */
const newId = (kind: string) => `${kind}-or-${crypto.randomUUID()}`;

interface PendingCall {
  id: string;
  name: string;
  arguments: string;
}

/** What one model call gave: its text, its reasoning details and the tools it asked for. */
interface Step {
  text: string;
  reasoningDetails: unknown[];
  calls: PendingCall[];
}

/**
 * Writes one streamed model call as UI message chunks: its reasoning, its text, then the tool calls
 * it asked for, whole. Returns what it gave, or `undefined` when the stream ended with an error.
 */
async function writeStep(response: Response, write: WriteChunk): Promise<Step | undefined> {
  let open: { type: 'text' | 'reasoning'; id: string } | undefined;
  const switchTo = (type: 'text' | 'reasoning') => {
    if (open?.type === type) return open.id;
    if (open) write({ type: `${open.type}-end`, id: open.id });
    open = { type, id: newId(type) };
    write({ type: `${type}-start`, id: open.id });
    return open.id;
  };
  const step: Step = { text: '', reasoningDetails: [], calls: [] };

  for await (const data of readEvents(response.body!)) {
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data) as StreamChunk;
    } catch {
      continue;
    }
    if (chunk.error) {
      if (open) write({ type: `${open.type}-end`, id: open.id });
      write({
        type: 'error',
        errorText: `OpenRouter: ${chunk.error.message ?? 'the model failed'}`,
      });
      return undefined;
    }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.reasoning) {
      write({ type: 'reasoning-delta', id: switchTo('reasoning'), delta: delta.reasoning });
    }
    // Reasoning models that call tools need their reasoning back with the results.
    if (delta.reasoning_details?.length) step.reasoningDetails.push(...delta.reasoning_details);
    if (delta.content) {
      step.text += delta.content;
      write({ type: 'text-delta', id: switchTo('text'), delta: delta.content });
    }
    for (const call of delta.tool_calls ?? []) {
      const pending = (step.calls[call.index ?? 0] ??= { id: '', name: '', arguments: '' });
      if (call.id) pending.id = call.id;
      // Most providers send the name once; some repeat it whole in every chunk.
      const name = call.function?.name;
      if (name) pending.name = name.startsWith(pending.name) ? name : pending.name + name;
      if (call.function?.arguments) pending.arguments += call.function.arguments;
    }
  }
  if (open) write({ type: `${open.type}-end`, id: open.id });
  step.calls = step.calls
    .filter(Boolean)
    .map((call) => ({ ...call, id: call.id || newId('call') }));
  return step;
}

function parseArguments(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text || '{}');
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * `POST /api/chat` for a model of OpenRouter: sends the conversation to OpenRouter with the key the
 * client sent in `Authorization`, and streams the reply back as a UI message stream. `get_weather`
 * runs here, then the model is called again with its result, within the same step of the reply;
 * `send_email` ends the reply, and the user's answer comes back in the next request, as with the
 * simulated models. A tool the backend does not know gets an error as its result.
 */
export async function openRouterChat(
  request: ChatRequest,
  authorization: string | null,
  signal: AbortSignal | null,
  network: Network,
): Promise<Response> {
  if (!authorization?.startsWith('Bearer ') || authorization.length <= 'Bearer '.length) {
    return new Response('Connect OpenRouter to use this model.', { status: 401 });
  }
  const model = request.modelName!.slice(OPENROUTER_PREFIX.length);
  const listed = await openRouterModels(network).then(
    (models) => models.find((m) => m.id === request.modelName),
    () => undefined,
  );
  const capabilities = { tools: listed?.tools ?? false, images: listed?.images ?? false };
  const messages = toOpenAIMessages(request.system, request.messages, capabilities);

  const call = () =>
    network(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...(capabilities.tools ? { tools: TOOLS } : {}),
        ...(request.reasoningEffort && listed?.reasoning
          ? { reasoning: { effort: request.reasoningEffort } }
          : {}),
      }),
      signal,
    });

  // The first call fails the request itself, so its status and reason reach the client.
  const first = await call();
  if (!first.ok || !first.body) {
    return new Response(await refusal(first), { status: first.status || 502 });
  }

  return uiMessageStreamResponse(async (write) => {
    write({ type: 'start' });
    // One step for the whole reply: the client counts steps to stop runaway tool loops, and the
    // calls made here are this backend's business. MAX_STEPS bounds them instead.
    write({ type: 'start-step' });
    const end = (finishReason: 'stop' | 'tool-calls') => {
      write({ type: 'finish-step' });
      write({ type: 'finish', finishReason });
    };
    let response = first;
    for (let round = 1; ; round++) {
      const step = await writeStep(response, write);
      if (!step) return;
      const { calls } = step;
      for (const call of calls) {
        write({
          type: 'tool-input-available',
          toolCallId: call.id,
          toolName: call.name,
          input: parseArguments(call.arguments),
        });
      }
      if (!calls.length) return end('stop');

      messages.push({
        role: 'assistant',
        content: step.text || null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.arguments || '{}' },
        })),
        ...(step.reasoningDetails.length ? { reasoning_details: step.reasoningDetails } : {}),
      });
      for (const call of calls) {
        if (call.name === 'send_email') continue;
        const output =
          call.name === 'get_weather'
            ? forecastFor(String(parseArguments(call.arguments)['city'] ?? ''))
            : { error: `There is no tool named ${call.name}.` };
        write({ type: 'tool-output-available', toolCallId: call.id, output });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
      }
      // `send_email` waits for the user: the answer comes back in the next request.
      if (calls.some((c) => c.name === 'send_email') || round >= MAX_STEPS) {
        return end('tool-calls');
      }
      response = await call();
      if (!response.ok || !response.body) {
        write({ type: 'error', errorText: await refusal(response) });
        return;
      }
    }
  }, signal);
}
