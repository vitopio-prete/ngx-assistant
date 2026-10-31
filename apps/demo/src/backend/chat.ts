import {
  uiMessageStreamResponse,
  writeReasoning,
  writeText,
  type Pause,
  type WriteChunk,
} from './ui-message-stream';

const WORD_DELAY_MS = 80;
const TOOL_DELAY_MS = 300;

/** A message containing this command makes the request fail with a server error. */
const FAIL_COMMAND = '/error';
/** A message containing this command makes the reply fail halfway through its stream. */
const FAIL_STREAM_COMMAND = '/error-stream';

/** What `provideDataStreamRuntime` posts: the conversation and the model context config. */
interface ChatRequest {
  messages: Message[];
  modelName?: string;
  reasoningEffort?: string;
}

type Part =
  | { type: 'text'; text: string }
  | { type: 'file'; filename?: string; mediaType: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | {
      type: 'tool-result';
      toolCallId: string;
      toolName: string;
      output: { type: string; value: unknown };
    };

type Message =
  | { role: 'system'; content: string }
  | { role: 'user' | 'assistant' | 'tool'; content: Part[]; unstable_id?: string };

let toolCalls = 0;
const newToolCallId = () => `call-${Date.now()}-${++toolCalls}`;

// How many replies each user message has had: a regenerated reply says which take it is.
const takes = new Map<string, number>();

/**
 * `POST /api/chat`: a deterministic stand-in for a model behind an AI SDK route. It echoes the
 * last message, calls `get_weather` (run here, on the server) for "weather in <city>", and
 * `send_email` (a tool without `execute`: the user approves it in the browser) for "send an email
 * to <address>".
 */
export async function chat(body: string, signal: AbortSignal | null): Promise<Response> {
  const request = JSON.parse(body) as ChatRequest;
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

  const shout = request.modelName === 'shout';
  const say = (reply: string) => (shout ? reply.toUpperCase() : reply);

  return uiMessageStreamResponse(async (write, pause) => {
    write({ type: 'start' });
    write({ type: 'start-step' });
    if (request.reasoningEffort) {
      writeReasoning(write, `Thinking with ${request.reasoningEffort} effort.`);
    }

    if (last.role === 'tool') {
      await answerToolResult(write, pause, last.content, say);
      return finish(write, 'stop');
    }

    const weather = /weather in ([^?.!,]+)/i.exec(text);
    if (weather) {
      await getWeather(write, pause, weather[1].trim(), say);
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

    await writeText(write, pause, say(echo(last, text)), WORD_DELAY_MS);
    if (text.includes(FAIL_STREAM_COMMAND)) {
      write({ type: 'error', errorText: 'The stream failed on purpose.' });
      return;
    }
    finish(write, 'stop');
  }, signal);
}

function echo(last: Extract<Message, { content: Part[] }>, text: string) {
  const key = last.unstable_id ?? text;
  const take = (takes.get(key) ?? 0) + 1;
  takes.set(key, take);

  const files = last.content.flatMap((part) => {
    if (part.type === 'file') return [part.filename ?? 'a file'];
    const name = part.type === 'text' && /^<attachment name="([^"]*)">/.exec(part.text)?.[1];
    return name ? [name] : [];
  });
  const prefix = take === 1 ? 'Echo:' : `Echo (${take}):`;
  const suffix = files.length ? ` [attached: ${files.join(', ')}]` : '';
  return `${prefix} ${text}${suffix}`;
}

async function getWeather(
  write: WriteChunk,
  pause: Pause,
  city: string,
  say: (s: string) => string,
) {
  const toolCallId = newToolCallId();
  write({ type: 'tool-input-available', toolCallId, toolName: 'get_weather', input: { city } });
  await pause(TOOL_DELAY_MS);
  const forecast = forecastFor(city);
  write({ type: 'tool-output-available', toolCallId, output: forecast });
  write({ type: 'finish-step' });
  write({ type: 'start-step' });
  await writeText(
    write,
    pause,
    say(`It is ${forecast.temperature}°C and ${forecast.condition} in ${city}.`),
    WORD_DELAY_MS,
  );
}

async function answerToolResult(
  write: WriteChunk,
  pause: Pause,
  results: Part[],
  say: (s: string) => string,
) {
  for (const part of results) {
    if (part.type !== 'tool-result' || part.toolName !== 'send_email') continue;
    const answer = part.output.value as { approved?: boolean; to?: string } | null;
    const reply = answer?.approved
      ? `Done: the email to ${answer.to ?? 'them'} is sent.`
      : 'Understood, I did not send the email.';
    await writeText(write, pause, say(reply), WORD_DELAY_MS);
  }
}

function finish(write: WriteChunk, finishReason: 'stop' | 'tool-calls') {
  write({ type: 'finish-step' });
  write({ type: 'finish', finishReason });
}

const CONDITIONS = ['sunny', 'cloudy', 'rainy', 'windy', 'foggy'];

/** The same city always gets the same weather. */
function forecastFor(city: string) {
  let hash = 0;
  for (const char of city.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { city, temperature: 5 + (hash % 25), condition: CONDITIONS[hash % CONDITIONS.length] };
}
