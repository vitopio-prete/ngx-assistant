import type { ChatModelAdapter, ChatModelRunResult, ThreadMessage } from '@ngx-assistant/engine';

const MARKDOWN = `Here is what the **styled thread** renders:

## Markdown

- lists, *emphasis* and \`inline code\`
- [links](https://angular.dev) that open in a new tab
- raw HTML such as <b>this</b> shown as text

\`\`\`ts
const answer = 42;
\`\`\`

| Part | Component |
| --- | --- |
| text | nxa-markdown-text |
| reasoning | nxa-reasoning |
| tool call | nxa-tool-fallback |

> Try \`/reasoning\`, \`/tool\`, \`/approval\`, \`/approval-card\`, \`/question\` or \`/error\`.`;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

const lastUserText = (messages: readonly ThreadMessage[]) => {
  const last = messages.findLast((message) => message.role === 'user');
  return (
    last?.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join(' ')
      .trim() ?? ''
  );
};

/** Streams `text` a few characters at a time. */
async function* stream(
  text: string,
  signal: AbortSignal,
  before: ChatModelRunResult['content'] = [],
): AsyncGenerator<ChatModelRunResult> {
  for (let end = 0; end <= text.length; end += 6) {
    await sleep(25, signal);
    yield { content: [...(before ?? []), { type: 'text', text: text.slice(0, end) }] };
  }
  yield { content: [...(before ?? []), { type: 'text', text }] };
}

/** A model that runs in the page and answers with every kind of part the thread renders. */
export const previewModel: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const prompt = lastUserText(messages);
    if (prompt.includes('/error')) {
      await sleep(400, abortSignal);
      throw new Error('The model is unavailable (simulated failure).');
    }
    if (prompt.includes('/reasoning')) {
      const thought =
        'The user wants to see the reasoning. I will think for a moment, then answer briefly.';
      for (let end = 0; end <= thought.length; end += 4) {
        await sleep(30, abortSignal);
        yield { content: [{ type: 'reasoning', text: thought.slice(0, end) }] };
      }
      yield* stream('Done thinking: this answer came after a **reasoning** part.', abortSignal, [
        { type: 'reasoning', text: thought },
      ]);
      return;
    }
    if (prompt.includes('/tool')) {
      const startedAt = Date.now();
      yield {
        content: [
          {
            type: 'tool-call',
            toolCallId: 'weather',
            toolName: 'get_weather',
            args: { city: 'Rome' },
            argsText: '{"city":"Rome"}',
            timing: { startedAt },
          },
        ],
      };
      await sleep(1500, abortSignal);
      yield* stream('It is sunny in Rome.', abortSignal, [
        {
          type: 'tool-call',
          toolCallId: 'weather',
          toolName: 'get_weather',
          args: { city: 'Rome' },
          argsText: '{"city":"Rome"}',
          result: { temperature: 24, condition: 'sunny' },
          timing: { startedAt, completedAt: Date.now() },
        },
      ]);
      return;
    }
    if (prompt.includes('/approval-card')) {
      yield {
        content: [
          {
            type: 'tool-call',
            toolCallId: 'publish',
            toolName: 'publish_release',
            args: { version: '0.1.0', tag: 'latest' },
            argsText: '{"version":"0.1.0","tag":"latest"}',
            approval: {
              id: 'publish-1',
              options: [
                { id: 'once', kind: 'allow-once' },
                { id: 'always', kind: 'allow-always' },
                { id: 'never', kind: 'reject-once' },
              ],
            },
          },
        ],
        status: { type: 'requires-action', reason: 'tool-calls' },
      };
      return;
    }
    if (prompt.includes('/approval') || prompt.includes('/question')) {
      const question = prompt.includes('/question');
      yield {
        content: [
          {
            type: 'tool-call',
            toolCallId: question ? 'branch' : 'delete',
            toolName: question ? 'choose_branch' : 'delete_file',
            args: question ? {} : { path: 'notes.txt' },
            argsText: question ? '{}' : '{"path":"notes.txt"}',
            approval: question
              ? { id: 'ask-1', prompt: 'Which branch should I deploy?', display: 'text' }
              : {
                  id: 'approve-1',
                  prompt: 'Delete notes.txt?',
                  options: [
                    { id: 'once', kind: 'allow-once' },
                    {
                      id: 'always',
                      kind: 'allow-always',
                      confirm: { description: 'Future deletions will not ask again.' },
                    },
                    { id: 'never', kind: 'reject-once' },
                  ],
                },
          },
        ],
        status: { type: 'requires-action', reason: 'tool-calls' },
      };
      return;
    }
    yield* stream(MARKDOWN, abortSignal);
  },
};
