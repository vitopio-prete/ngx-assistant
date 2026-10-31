import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  ChatModelAdapter,
  RemoteThreadListAdapter,
  RemoteThreadMetadata,
} from '@ngx-assistant/engine';
import { provideLocalRuntime } from '../local-runtime';
import { injectAssistant } from '../scopes';
import { provideRemoteThreadListRuntime } from './remote-thread-list-runtime';
import { titleStream, titleStreamFromResponse, type AssistantStream } from './title-stream';

const replyModel: ChatModelAdapter = {
  async *run() {
    yield { content: [{ type: 'text', text: 'hello' }] };
  },
};

/** Runs one message on a saved thread and returns the title its adapter's stream gave it. */
const titleFrom = async (generateTitle: () => Promise<AssistantStream>, expectTitle = true) => {
  const threads: RemoteThreadMetadata[] = [{ status: 'regular', remoteId: 'thread-a' }];
  const adapter: RemoteThreadListAdapter = {
    list: async () => ({ threads }),
    initialize: async (threadId) => ({ remoteId: threadId, externalId: undefined }),
    rename: async () => undefined,
    archive: async () => undefined,
    unarchive: async () => undefined,
    delete: async () => undefined,
    generateTitle: vi.fn(generateTitle),
    fetch: async (remoteId) => ({ status: 'regular', remoteId }),
  };
  const injector = createEnvironmentInjector(
    [provideRemoteThreadListRuntime({ adapter, runtime: () => provideLocalRuntime(replyModel) })],
    TestBed.inject(EnvironmentInjector),
  );
  const assistant = injector.runInContext(() => injectAssistant());
  await assistant.threads.switchToThread('thread-a');
  assistant.thread.append('Hi');

  const item = () => assistant.threads.getItemById('thread-a').getState();
  await vi.waitFor(() => expect(adapter.generateTitle).toHaveBeenCalled());
  if (expectTitle) await vi.waitFor(() => expect(item().title).toBeDefined());
  else await new Promise((resolve) => setTimeout(resolve, 50));
  const title = item().title;
  injector.destroy();
  return { title };
};

const sse = (chunks: readonly Record<string, unknown>[]) =>
  `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;

const uiTitle = (title: string, headers: HeadersInit = { 'x-vercel-ai-ui-message-stream': 'v1' }) =>
  new Response(
    sse([
      { type: 'start' },
      { type: 'start-step' },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: title },
      { type: 'text-end', id: 't' },
      { type: 'finish-step' },
      { type: 'finish' },
    ]),
    { headers },
  );

describe('titleStream', () => {
  it('gives the thread the title it carries', async () => {
    const { title } = await titleFrom(async () => titleStream('Greetings'));

    expect(title).toBe('Greetings');
  });
});

describe('titleStreamFromResponse', () => {
  it('reads a title streamed as a UI message stream', async () => {
    const { title } = await titleFrom(() => titleStreamFromResponse(uiTitle('Weather in Rome')));

    expect(title).toBe('Weather in Rome');
  });

  it('falls back to the UI message stream without a protocol header', async () => {
    const { title } = await titleFrom(() => titleStreamFromResponse(uiTitle('Plain', {})));

    expect(title).toBe('Plain');
  });

  it('reads a title streamed as a data stream', async () => {
    const { title } = await titleFrom(() =>
      titleStreamFromResponse(
        new Response('0:"Data "\n0:"title"\n', { headers: { 'x-vercel-ai-data-stream': 'v1' } }),
      ),
    );

    expect(title).toBe('Data title');
  });

  it('uses the protocol it is given over the response header', async () => {
    const { title } = await titleFrom(() =>
      titleStreamFromResponse(new Response('0:"Forced"\n'), { protocol: 'data-stream' }),
    );

    expect(title).toBe('Forced');
  });

  it('rejects a response that is not ok', async () => {
    await expect(
      titleStreamFromResponse(new Response('no title', { status: 503 })),
    ).rejects.toThrow('Status 503: no title');
  });

  it('rejects a response without body', async () => {
    await expect(titleStreamFromResponse(new Response(null))).rejects.toThrow(
      'Response body is null',
    );
  });

  it('leaves the title unset when the stream fails', async () => {
    const failing = new Response(
      sse([{ type: 'start' }, { type: 'error', errorText: 'no title' }]),
      { headers: { 'x-vercel-ai-ui-message-stream': 'v1' } },
    );
    const { title } = await titleFrom(() => titleStreamFromResponse(failing), false);

    expect(title).toBeUndefined();
  });
});
