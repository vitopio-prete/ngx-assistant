import { openRouterChat } from './openrouter-chat';
import { showcaseReply } from './showcase';
import { forecastFor } from './weather';
import { OPENROUTER_PREFIX, type Network } from './openrouter-models';
import {
  uiMessageStreamResponse,
  writeReasoning,
  writeStreamedReasoning,
  writeText,
  type Pause,
  type WriteChunk,
} from './ui-message-stream';

const WORD_DELAY_MS = 80;
/** Showcase replies are longer: their words come faster, as a model's tokens do. */
const SHOWCASE_DELAY_MS = 20;
const TOOL_DELAY_MS = 300;

/** A message containing this command makes the request fail with a server error. */
const FAIL_COMMAND = '/error';
/** A message containing this command makes the reply fail halfway through its stream. */
const FAIL_STREAM_COMMAND = '/error-stream';

/** What `provideDataStreamRuntime` posts: the conversation and the model context config. */
export interface ChatRequest {
  system?: string;
  messages: Message[];
  modelName?: string;
  reasoningEffort?: string;
}

export type Part =
  | { type: 'text'; text: string }
  | { type: 'file'; filename?: string; mediaType: string; data?: unknown }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | {
      type: 'tool-result';
      toolCallId: string;
      toolName: string;
      output: { type: string; value: unknown };
    };

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user' | 'assistant' | 'tool'; content: Part[]; unstable_id?: string };

let toolCalls = 0;
const newToolCallId = () => `call-${Date.now()}-${++toolCalls}`;

// How many replies each user message has had: a regenerated reply says which take it is.
const takes = new Map<string, number>();

/** The simulated model that repeats the message; any other simulated model is Showcase. */
export const ECHO_MODEL = 'echo';

/**
 * `POST /api/chat`: a deterministic stand-in for a model behind an AI SDK route. For every
 * simulated model, it calls `get_weather` (run here, on the server) for "weather in <city>", and
 * `send_email` (a tool without `execute`: the user approves it in the browser) for "send an email
 * to <address>". Otherwise Echo repeats the last message, and Showcase answers with the rich reply
 * of {@link showcaseReply}. The models of OpenRouter (`openrouter/...`) go to
 * {@link openRouterChat}.
 */
export async function chat(
  body: string,
  signal: AbortSignal | null,
  { authorization, network }: { authorization: string | null; network: Network },
): Promise<Response> {
  const request = JSON.parse(body) as ChatRequest;
  if (request.modelName?.startsWith(OPENROUTER_PREFIX)) {
    return openRouterChat(request, authorization, signal, network);
  }
  const last = request.messages.at(-1);
  if (!last || last.role === 'system')
    return new Response('No message to answer.', { status: 400 });

  const text = last.content
    .map((part) => (part.type === 'text' && !part.text.startsWith('<attachment') ? part.text : ''))
    .join('')
    .trim();
  if (text.includes(FAIL_COMMAND) && !text.includes(FAIL_STREAM_COMMAND)) {
    return new Response('The backend failed on purpose.', { status: 500 });
  }

  const echoModel = request.modelName === ECHO_MODEL;

  return uiMessageStreamResponse(async (write, pause) => {
    write({ type: 'start' });
    write({ type: 'start-step' });
    if (echoModel && request.reasoningEffort) {
      writeReasoning(write, `Thinking with ${request.reasoningEffort} effort.`);
    }

    if (last.role === 'tool') {
      await answerToolResult(write, pause, last.content);
      return finish(write, 'stop');
    }

    const weather = /weather in ([^?.!,]+)/i.exec(text);
    if (weather) {
      await getWeather(write, pause, weather[1].trim());
      return finish(write, 'stop');
    }

    const email = /send an? email to (\S+)/i.exec(text);
    if (email) {
      write({
        type: 'tool-input-available',
        toolCallId: newToolCallId(),
        toolName: 'send_email',
        input: { to: email[1], subject: 'Hello from ngx-assistant' },
      });
      // No result: the run waits for the user's answer, which comes back in the next request.
      return finish(write, 'tool-calls');
    }

    if (echoModel) {
      await writeText(write, pause, echo(last, text), WORD_DELAY_MS);
    } else {
      await showcase(write, pause, last, text, request.reasoningEffort);
    }
    if (text.includes(FAIL_STREAM_COMMAND)) {
      write({ type: 'error', errorText: 'The stream failed on purpose.' });
      return;
    }
    finish(write, 'stop');
  }, signal);
}

type ContentMessage = Extract<Message, { content: Part[] }>;

/** Which take of a reply to `last` this one is: 1, then 2 for its first regeneration, and so on. */
function nextTake(last: ContentMessage, text: string): number {
  const key = last.unstable_id ?? text;
  const take = (takes.get(key) ?? 0) + 1;
  takes.set(key, take);
  return take;
}

/** The names of the files attached to a message. */
function attachedFiles(message: ContentMessage): string[] {
  return message.content.flatMap((part) => {
    if (part.type === 'file') return [part.filename ?? 'a file'];
    const name = part.type === 'text' && /^<attachment name="([^"]*)">/.exec(part.text)?.[1];
    return name ? [name] : [];
  });
}

function echo(last: ContentMessage, text: string) {
  const take = nextTake(last, text);
  const files = attachedFiles(last);
  const prefix = take === 1 ? 'Echo:' : `Echo (${take}):`;
  const suffix = files.length ? ` [attached: ${files.join(', ')}]` : '';
  return `${prefix}${text ? ` ${text}` : ''}${suffix}`;
}

/** The reply of Showcase: its reasoning, a `get_weather` call when it plans a day, then markdown. */
async function showcase(
  write: WriteChunk,
  pause: Pause,
  last: ContentMessage,
  text: string,
  effort: string | undefined,
) {
  const reply = showcaseReply(text, nextTake(last, text), effort);
  await writeStreamedReasoning(write, pause, reply.reasoning, SHOWCASE_DELAY_MS);
  let forecast: ReturnType<typeof forecastFor> | undefined;
  if (reply.city !== undefined) {
    forecast = await callGetWeather(write, pause, reply.city);
  }
  const files = attachedFiles(last);
  const attached = files.length ? `\n\n_Attached: ${files.join(', ')}._` : '';
  await writeText(write, pause, reply.text(forecast) + attached, SHOWCASE_DELAY_MS);
}

/** Calls `get_weather` and streams its result, then starts the step that answers with it. */
async function callGetWeather(write: WriteChunk, pause: Pause, city: string) {
  const toolCallId = newToolCallId();
  write({ type: 'tool-input-available', toolCallId, toolName: 'get_weather', input: { city } });
  await pause(TOOL_DELAY_MS);
  const forecast = forecastFor(city);
  write({ type: 'tool-output-available', toolCallId, output: forecast });
  write({ type: 'finish-step' });
  write({ type: 'start-step' });
  return forecast;
}

async function getWeather(write: WriteChunk, pause: Pause, city: string) {
  const forecast = await callGetWeather(write, pause, city);
  await writeText(
    write,
    pause,
    `It is ${forecast.temperature}°C and ${forecast.condition} in ${city}.`,
    WORD_DELAY_MS,
  );
}

async function answerToolResult(write: WriteChunk, pause: Pause, results: Part[]) {
  for (const part of results) {
    if (part.type !== 'tool-result' || part.toolName !== 'send_email') continue;
    const answer = part.output.value as { approved?: boolean; to?: string } | null;
    const reply = answer?.approved
      ? `Done: the email to ${answer.to ?? 'them'} is sent.`
      : 'Understood, I did not send the email.';
    await writeText(write, pause, reply, WORD_DELAY_MS);
  }
}

function finish(write: WriteChunk, finishReason: 'stop' | 'tool-calls') {
  write({ type: 'finish-step' });
  write({ type: 'finish', finishReason });
}
