import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  type ChatModelAdapter,
} from '@ngx-assistant/engine';

const WORD_DELAY_MS = 80;

/** A message containing this command makes the reply fail, to show the error state. */
export const FAIL_COMMAND = '/error';

// How many replies each user message has had: a regenerated reply says which take it is.
const takes = new Map<string, number>();

/**
 * Fake streaming model: replies with the user's text, one word at a time, and names the files
 * attached to it. Each regeneration of a reply is a new take, so branches tell each other apart.
 */
export const echoModel: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const last = messages.at(-1);
    const text =
      last?.content.map((part) => (part.type === 'text' ? part.text : '')).join('') ?? '';
    const take = (takes.get(last?.id ?? '') ?? 0) + 1;
    takes.set(last?.id ?? '', take);

    const files = last?.role === 'user' ? last.attachments.map((a) => a.name) : [];
    const prefix = take === 1 ? 'Echo:' : `Echo (${take}):`;
    const suffix = files.length ? ` [attached: ${files.join(', ')}]` : '';
    const words = `${prefix} ${text}${suffix}`.split(' ').filter(Boolean);

    let reply = '';
    for (const word of words) {
      await new Promise((resolve) => setTimeout(resolve, WORD_DELAY_MS));
      if (abortSignal.aborted) return;
      reply += (reply ? ' ' : '') + word;
      yield { content: [{ type: 'text', text: reply }] };
    }
    if (text.includes(FAIL_COMMAND)) throw new Error('The echo model failed on purpose.');
  },
};

/** Images and text files: the attachments the echo model accepts. */
export const demoAttachments = () =>
  new CompositeAttachmentAdapter([
    new SimpleImageAttachmentAdapter(),
    new SimpleTextAttachmentAdapter(),
  ]);
