import type { ThreadMessage } from '@ngx-assistant/engine';
import {
  toGenericMessages,
  type GenericFilePart,
  type GenericMessage,
  type GenericTextPart,
  type GenericToolCallPart,
  type GenericToolResultPart,
} from 'assistant-stream';

type JSONValue = null | string | number | boolean | JSONValue[] | { [key: string]: JSONValue };

// The message shapes the AI SDK's language model specification expects, kept structural so the
// package does not depend on the specification's types.

export interface LanguageModelTextPart {
  type: 'text';
  text: string;
}

export interface LanguageModelFilePart {
  type: 'file';
  data: string | URL;
  mediaType: string;
  filename?: string;
}

export interface LanguageModelToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export type LanguageModelToolResultOutput =
  | { type: 'json'; value: JSONValue }
  | { type: 'error-json'; value: JSONValue }
  | {
      type: 'content';
      value: (
        { type: 'text'; text: string } | { type: 'media'; data: string; mediaType: string }
      )[];
    };

export interface LanguageModelToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output: LanguageModelToolResultOutput;
}

export type LanguageModelMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: (LanguageModelTextPart | LanguageModelFilePart)[] }
  | {
      role: 'assistant';
      content: (LanguageModelTextPart | LanguageModelFilePart | LanguageModelToolCallPart)[];
    }
  | { role: 'tool'; content: LanguageModelToolResultPart[] };

const toFilePart = (part: GenericFilePart): LanguageModelFilePart => ({
  type: 'file',
  data: part.data,
  mediaType: part.mediaType,
  ...(part.filename && { filename: part.filename }),
});

const convertUserContent = (
  content: (GenericTextPart | GenericFilePart)[],
): (LanguageModelTextPart | LanguageModelFilePart)[] =>
  content.map((part) => (part.type === 'text' ? part : toFilePart(part)));

const convertAssistantContent = (
  content: (GenericTextPart | GenericFilePart | GenericToolCallPart)[],
): (LanguageModelTextPart | LanguageModelFilePart | LanguageModelToolCallPart)[] =>
  content.map((part) => {
    if (part.type === 'text') return part;
    if (part.type === 'file') return toFilePart(part);
    return {
      type: 'tool-call',
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      input: part.args,
    };
  });

const convertToolContent = (content: GenericToolResultPart[]): LanguageModelToolResultPart[] =>
  content.map((part) => ({
    type: 'tool-result',
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    output: part.isError
      ? { type: 'error-json', value: part.result as JSONValue }
      : part.modelContent !== undefined
        ? {
            type: 'content',
            value: part.modelContent.map((content) =>
              content.type === 'text'
                ? { type: 'text', text: content.text }
                : { type: 'media', data: content.data, mediaType: content.mediaType },
            ),
          }
        : { type: 'json', value: part.result as JSONValue },
  }));

const convertGenericMessage = (generic: GenericMessage): LanguageModelMessage => {
  switch (generic.role) {
    case 'system':
      return { role: 'system', content: generic.content };
    case 'user':
      return { role: 'user', content: convertUserContent(generic.content) };
    case 'assistant':
      return { role: 'assistant', content: convertAssistantContent(generic.content) };
    case 'tool':
      return { role: 'tool', content: convertToolContent(generic.content) };
  }
};

type GenericSource = Parameters<typeof toGenericMessages>[0];

/**
 * Converts thread messages to the message format of the AI SDK's language model specification,
 * the one a `streamText({ messages })` backend receives. Tool results become `tool` messages, an
 * assistant message split by tool calls becomes several messages.
 *
 * With `unstable_includeId`, each converted user and assistant message carries the id of the
 * thread message it comes from as `unstable_id`.
 */
export function toLanguageModelMessages(
  messages: readonly ThreadMessage[],
  options: { unstable_includeId?: boolean | undefined } = {},
): LanguageModelMessage[] {
  if (!options.unstable_includeId) {
    return toGenericMessages(messages as unknown as GenericSource).map(convertGenericMessage);
  }

  const result: LanguageModelMessage[] = [];
  for (const [index, message] of messages.entries()) {
    // Converting one message at a time hides whether a later message follows it, so an assistant
    // message that is not the last one is converted as settled, like the whole list would be.
    const source =
      message.role === 'assistant' && index < messages.length - 1
        ? { ...message, status: { type: 'incomplete' } }
        : message;
    for (const generic of toGenericMessages([source] as unknown as GenericSource)) {
      const converted = convertGenericMessage(generic);
      if (generic.role !== 'tool') Object.assign(converted, { unstable_id: message.id });
      result.push(converted);
    }
  }
  return result;
}
