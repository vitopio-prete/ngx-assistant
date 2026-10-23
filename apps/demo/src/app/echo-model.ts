import type { ChatModelAdapter } from '@ngx-assistant/engine';

const WORD_DELAY_MS = 80;

/** Fake streaming model: replies with the user's text, one word at a time. */
export const echoModel: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const last = messages.at(-1);
    const text =
      last?.content.map((part) => (part.type === 'text' ? part.text : '')).join('') ?? '';
    const words = `Echo: ${text}`.split(' ');
    let reply = '';
    for (const word of words) {
      await new Promise((resolve) => setTimeout(resolve, WORD_DELAY_MS));
      if (abortSignal.aborted) return;
      reply += (reply ? ' ' : '') + word;
      yield { content: [{ type: 'text', text: reply }] };
    }
  },
};
