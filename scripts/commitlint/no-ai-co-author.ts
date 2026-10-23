/** Names that identify an AI agent in a `Co-authored-by:` trailer (matched case-insensitively). */
export const AI_CO_AUTHOR_MARKERS: readonly string[] = [
  'claude',
  'anthropic',
  'chatgpt',
  'openai',
  'gpt-',
  'copilot',
  'gemini',
  'bard',
  'devin',
  'codeium',
  'cursor',
  'windsurf',
  'tabnine',
  'aider',
  'cody',
  'jules',
  'junie',
];

const CO_AUTHOR_TRAILER = /^co-authored-by:\s*(.+)$/gim;

/** Returns the `Co-authored-by` values in `message` that credit an AI agent. */
export function findAiCoAuthorTrailers(message: string): string[] {
  const found: string[] = [];
  for (const match of message.matchAll(CO_AUTHOR_TRAILER)) {
    const value = match[1].trim();
    if (AI_CO_AUTHOR_MARKERS.some((marker) => value.toLowerCase().includes(marker))) {
      found.push(value);
    }
  }
  return found;
}
