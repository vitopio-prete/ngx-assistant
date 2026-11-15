// End-to-end check of the production demo bundle in jsdom, against the backend it ships: the
// thread, its branches, editing, regenerating, copying, attachments, errors, suggestions, tool
// calls with an approval, the model selector, the thread list and its row menu, the assistant
// modal, the theme, what a reload brings back, and the free models of OpenRouter: the account, the
// models list and replies streamed through the backend, against a stand-in for OpenRouter.
// Every request to the backend and to OpenRouter is recorded and checked.
// Run after `ng build demo`. Exits with a non-zero code on the first failed check.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../dist/demo/browser',
);
const html = fs
  .readFileSync(path.join(dist, 'index.html'), 'utf8')
  .replace(/<script[^>]*><\/script>/g, '');
const main = fs.readdirSync(dist).find((f) => /^main-.*\.js$/.test(f));
assert.ok(main, `no main-*.js bundle in ${dist}, run "ng build demo" first`);
// The bundle is evaluated as a classic script, which only works while the build is a single file.
const chunks = fs.readdirSync(dist).filter((f) => /^chunk-.*\.js$/.test(f));
assert.deepEqual(chunks, [], 'the demo build has lazy chunks: load it as a module instead');
const bundle = fs.readFileSync(path.join(dist, main), 'utf8');

/** What the page logged as an error or a warning, and every request it made to the backend. */
let errors = [];
let requests = [];
/** Every request that reached the stand-in for OpenRouter. */
let openRouterCalls = [];
/** What the stand-in for OpenRouter answers: a page sets these before it loads. */
let openRouterModels;
let openRouterChat;
/** What the copy buttons wrote. */
let clipboard = [];
let window;
let document;

/**
 * Opens the demo in a new page; `storage` is the `localStorage` it starts with, and `session` its
 * `sessionStorage`.
 */
function openPage(storage = {}, url = 'http://localhost/', session = {}) {
  errors = [];
  requests = [];
  openRouterCalls = [];
  clipboard = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.forwardTo(console, { jsdomErrors: 'none' });
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));
  virtualConsole.on('warn', (...args) => errors.push(args.map(String).join(' ')));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url,
    virtualConsole,
  });
  window = dom.window;
  document = window.document;
  window.addEventListener('error', (e) => errors.push(e.message));
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
  for (const [key, value] of Object.entries(session)) window.sessionStorage.setItem(key, value);

  // jsdom has neither web streams, which the stream decoders extend, nor the fetch classes the
  // backend answers with: lend it Node's.
  for (const name of [
    'ReadableStream',
    'WritableStream',
    'TransformStream',
    'TextDecoderStream',
    'TextEncoder',
    'TextDecoder',
    'Response',
    'Headers',
  ]) {
    window[name] ??= globalThis[name];
  }
  // Nor the digest of Web Crypto, for the PKCE challenge of the OpenRouter sign-in.
  if (!window.crypto?.subtle) {
    Object.defineProperty(window, 'crypto', { configurable: true, value: globalThis.crypto });
  }

  // jsdom has no fetch: the page installs its backend as `fetch`, and this records each call.
  let backend;
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    get: () => record,
    set: (fetch) => void (backend = fetch),
  });
  function record(input, init = {}) {
    const url = new URL(String(input), window.location.href);
    if (url.origin === 'https://openrouter.ai') return openRouter(url, init);
    assert.ok(url.pathname.startsWith('/api/'), `unexpected request to ${url.href}`);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    requests.push({ method: init.method ?? 'GET', path: url.pathname, body, signal: init.signal });
    return backend(input, init);
  }

  // jsdom has no clipboard: record what the copy buttons write.
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: async (text) => void clipboard.push(text) },
  });

  const script = document.createElement('script');
  script.textContent = bundle;
  document.body.appendChild(script);
}

/** The stand-in for OpenRouter: its models list, its sign-in and its chat completions. */
async function openRouter(url, init = {}) {
  const call = {
    method: init.method ?? 'GET',
    path: url.pathname,
    authorization: new window.Headers(init.headers).get('Authorization'),
    body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    signal: init.signal,
  };
  openRouterCalls.push(call);
  if (call.path === '/api/v1/models') return openRouterModels();
  if (call.path === '/api/v1/auth/keys' && call.method === 'POST') {
    return Response.json({ key: 'sk-or-from-sign-in' });
  }
  if (call.path === '/api/v1/chat/completions' && call.method === 'POST') {
    return openRouterChat(call, openRouterCalls.filter((c) => c.path === call.path).length);
  }
  return new Response('Not found', { status: 404 });
}

/** The free models of the stand-in, among models the demo leaves out. */
const CATALOG = [
  {
    id: 'google/gemma-4-31b-it:free',
    name: 'Google: Gemma 4 31B (free)',
    context_length: 262144,
    supported_parameters: ['tools', 'reasoning', 'max_tokens'],
    architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
  },
  {
    id: 'openai/gpt-oss-20b:free',
    name: 'OpenAI: gpt-oss-20b (free)',
    context_length: 131072,
    supported_parameters: ['max_tokens'],
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  },
  {
    id: 'acme/unknown-1:free',
    name: 'Acme: Unknown 1 (free)',
    context_length: 1048576,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  },
  {
    id: 'google/gemma-4-31b-it',
    name: 'Google: Gemma 4 31B',
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  },
  {
    id: 'acme/painter:free',
    name: 'Acme: Painter (free)',
    architecture: { input_modalities: ['text'], output_modalities: ['image'] },
  },
];
const catalogResponse = () => Response.json({ data: CATALOG });

/** One chunk of OpenRouter's stream. */
const delta = (value, finish_reason = null) => ({ choices: [{ delta: value, finish_reason }] });

/**
 * A streamed answer of OpenRouter: a comment that keeps the connection open, then each chunk as an
 * event sent in two halves, then `[DONE]`. The request's abort fails the body, as over the network.
 */
function sse(chunks, signal, delayMs = 5) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      let failed = false;
      signal?.addEventListener('abort', () => {
        failed = true;
        controller.error(new DOMException('The request was aborted.', 'AbortError'));
      });
      controller.enqueue(encoder.encode(': OPENROUTER PROCESSING\n\n'));
      for (const chunk of chunks) {
        await sleep(delayMs);
        if (failed) return;
        const event = `data: ${JSON.stringify(chunk)}\n\n`;
        const half = Math.floor(event.length / 2);
        controller.enqueue(encoder.encode(event.slice(0, half)));
        controller.enqueue(encoder.encode(event.slice(half)));
      }
      if (failed) return;
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

/** A reply of the model, a few characters per chunk. */
const words = (reply) => reply.match(/.{1,6}/g).map((piece) => delta({ content: piece }));

openRouterModels = catalogResponse;
openRouterChat = (call) => sse(words('Hello from OpenRouter.'), call.signal);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (element) => element?.textContent.replace(/\s+/g, ' ').trim() ?? '';

const chat = () => document.querySelector('nxa-thread');
const $ = (selector) => chat().querySelector(selector);
const $$ = (selector) => [...chat().querySelectorAll(selector)];
const input = () => $('textarea[aria-label="Message"]');
const sendButton = () => $('button[aria-label="Send"]');
const stopButton = () => $('button[aria-label="Stop"]');
const isRunning = () => stopButton() !== null;
const articles = (role) =>
  $$(`[data-slot="thread-messages"] > [data-role${role ? `="${role}"` : ''}]`);
/** The text of a message: what the user wrote, or the text parts of a reply (not its reasoning). */
const messageText = (article) =>
  article.dataset.role === 'user'
    ? text(article.querySelector('[data-slot="user-message-content"]'))
    : [...article.querySelectorAll('[data-slot="assistant-message-content"] > nxa-markdown-text')]
        .map(text)
        .join(' ');
const messages = () =>
  articles().map((article) => ({ role: article.dataset.role, text: messageText(article) }));
const lastAssistant = () => articles('assistant').at(-1);
const lastReply = () => (lastAssistant() ? messageText(lastAssistant()) : '');
const branch = (article) => text(article.querySelector('[data-slot="branch-picker"]'));
const actionBar = (article) => article.querySelector('[nxaActionBarRoot]');
/** The button named `label`, by its accessible name or its text. */
const button = (root, label) =>
  [...root.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === label || text(b) === label,
  );
const welcome = () => $('[data-slot="thread-welcome"]');
const suggestions = () => $$('[nxaSuggestionTrigger]');
const threadFooter = () => $('[data-slot="thread-viewport-footer"]');
/** The new conversation layout: the composer in the middle, the suggestions below it. */
const isCentered = () =>
  !threadFooter().classList.contains('sticky') &&
  suggestions().length > 0 &&
  Boolean(composerForm().compareDocumentPosition(suggestions()[0]) & 4);
const composerForm = () => $('form[nxaComposerRoot]');
const attachmentName = (attachment) => text(attachment.querySelector('.min-w-0 > span'));

const sidebar = () => document.querySelector('nxa-thread-list');
const threadItems = () => [
  ...sidebar().querySelectorAll('nxa-thread-list-items nxa-thread-list-item'),
];
const archivedItems = () => [
  ...sidebar().querySelectorAll('nxa-thread-list-archived nxa-thread-list-item'),
];
const itemTitle = (item) => text(item.querySelector('[data-slot="thread-list-item-title"]'));
const threadTitles = () => threadItems().map(itemTitle);
const activeTitle = () => {
  const active = threadItems().find((item) => item.hasAttribute('data-active'));
  return active ? itemTitle(active) : '';
};
const newThread = () => sidebar().querySelector('[data-slot="thread-list-new"]');
const openThread = (title) =>
  threadItems()
    .find((item) => itemTitle(item) === title)
    .querySelector('[data-slot="thread-list-item-trigger"]')
    .click();

/** Picks `action` in the menu of a thread list row. */
async function threadAction(item, action) {
  button(item, 'More options').click();
  const menu = () => document.querySelector('[data-slot="thread-list-item-menu"]');
  await waitFor(menu, 'the thread menu');
  button(menu(), action).click();
  await waitFor(() => !menu(), 'the thread menu to close');
}

/** Opens the archived threads, which start collapsed. */
async function showArchived() {
  const toggle = () => sidebar().querySelector('nxa-thread-list-archived > button');
  await waitFor(toggle, 'the archived section');
  if (toggle().getAttribute('aria-expanded') !== 'true') toggle().click();
  await waitFor(() => archivedItems().length > 0, 'the archived threads');
}

const picker = () => document.querySelector('nxa-model-selector');
const modelTrigger = () => picker().querySelector('[data-slot="model-selector-trigger"]');

/** The requests to `/api/chat` made since `from`, with their bodies. */
const chatRequests = (from = 0) =>
  requests.slice(from).filter((r) => r.method === 'POST' && r.path === '/api/chat');
const lastChatBody = () => chatRequests().at(-1).body;
const stored = () => JSON.parse(window.localStorage.getItem('ngx-assistant-demo'));

async function waitFor(check, what, timeout = 5000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) assert.fail(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

// A run is over once the thread stops and every text is shown in full (the text is revealed a few
// characters per frame, and may still be catching up when the stream ends).
const settled = () =>
  !isRunning() && !document.querySelector('nxa-markdown-text[data-nxa-status="running"]');
const idle = () => waitFor(settled, 'the run to finish');

function type(value, target = input()) {
  target.value = value;
  target.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function pressEnter(init = {}, target = input()) {
  const event = new window.KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function drop(...files) {
  const event = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files, dropEffect: 'none' },
  });
  composerForm().dispatchEvent(event);
}

/** Waits until `start` triggered a request to `/api/chat`, then until its run is over. */
async function run(start) {
  const sent = chatRequests().length;
  await start();
  // A run that fails fast can be over before a check sees it running: count its request.
  await waitFor(() => chatRequests().length > sent, 'the run to start');
  await idle();
}

async function send(value) {
  type(value);
  await waitFor(() => sendButton() && !sendButton().disabled, 'send to enable');
  await run(() => sendButton().click());
}

/** Picks a model in the composer, then its effort level when given. */
async function pickModel(name, effort) {
  const content = picker().querySelector('[data-slot="model-selector-content"]');
  const open = async () => {
    modelTrigger().click();
    await waitFor(() => !content.hidden, 'the model list');
  };
  await open();
  [...content.querySelectorAll('[data-slot="model-selector-item"]')]
    .find((item) => text(item.querySelector('[data-slot="model-selector-item-name"]')) === name)
    .click();
  await waitFor(() => content.hidden, 'the model list to close');
  if (!effort) return;
  await open();
  button(content, effort).click();
  await waitFor(() => button(content, effort).getAttribute('aria-checked') === 'true', effort);
  modelTrigger().click();
  await waitFor(() => content.hidden, 'the model list to close');
}

const checks = [];
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`ok - ${name}`);
}

openPage();

await check('the app mounts on a new conversation, with suggestions', async () => {
  await waitFor(() => chat() && input(), 'the app to mount');
  await waitFor(() => requests.length > 1, 'the thread list and the models to load');
  assert.deepEqual(requests.map((r) => `${r.method} ${r.path}`).sort(), [
    'GET /api/models',
    'GET /api/threads',
  ]);
  // The backend reads the free models from OpenRouter, without a key.
  await waitFor(() => openRouterCalls.length > 0, 'the backend to read the models');
  assert.deepEqual(
    openRouterCalls.map((c) => [c.method, c.path, c.authorization]),
    [['GET', '/api/v1/models', null]],
  );
  assert.deepEqual(threadTitles(), []);
  assert.equal(newThread().dataset.active, 'true');
  await waitFor(() => welcome(), 'the welcome screen');
  assert.deepEqual(
    suggestions().map((s) => text(s.querySelector('[nxaSuggestionTitle]'))),
    ['Say hello', 'Check the weather', 'Send an email', 'Show an error'],
  );
  assert.ok(isCentered(), 'the composer is in the middle, with the suggestions below it');
  type('draft');
  await waitFor(() => suggestions().length === 0, 'the suggestions to hide while typing');
  type('');
  await waitFor(() => suggestions().length === 4, 'the suggestions to come back');
  assert.equal(modelTrigger().getAttribute('aria-label'), 'Model: Echo');
  assert.equal(sendButton().disabled, true);
  assert.equal(isRunning(), false);
  assert.deepEqual(messages(), []);
  assert.equal(document.activeElement, input());
});

await check('the first message saves the conversation, which the backend names', async () => {
  suggestions()[0].click();
  await waitFor(isRunning, 'the run to start');
  await idle();
  assert.deepEqual(messages(), [
    { role: 'user', text: 'Hello there!' },
    { role: 'assistant', text: 'Echo: Hello there!' },
  ]);
  assert.equal(welcome(), null);
  assert.ok(threadFooter().classList.contains('sticky'), 'the composer moved to the bottom');
  await waitFor(() => threadTitles()[0] === 'Hello there!', 'the generated title');
  assert.equal(activeTitle(), 'Hello there!');

  assert.equal(requests.filter((r) => r.method === 'POST' && r.path === '/api/threads').length, 1);
  assert.ok(requests.some((r) => r.path === '/api/threads/thread-1/title'));
  const body = lastChatBody();
  assert.equal(body.threadId, 'thread-1');
  assert.equal(body.modelName, 'echo');
  assert.deepEqual(body.messages.at(-1).content, [{ type: 'text', text: 'Hello there!' }]);
  await waitFor(() => stored().messages['thread-1']?.items.length === 2, 'the saved messages');
  assert.equal(stored().threads['thread-1'].title, 'Hello there!');
});

await check('Shift+Enter and Enter during IME composition do not send', async () => {
  type('ciao mondo');
  await waitFor(() => !sendButton().disabled, 'send to enable');
  const shift = pressEnter({ shiftKey: true });
  const ime = pressEnter({ isComposing: true });
  await sleep(50);
  assert.equal(shift.defaultPrevented, false);
  assert.equal(ime.defaultPrevented, false);
  assert.equal(articles().length, 2);
  assert.equal(input().value, 'ciao mondo');
});

await check('Enter sends, clears the composer and streams the reply', async () => {
  const enter = pressEnter();
  assert.equal(enter.defaultPrevented, true);
  await waitFor(isRunning, 'the run to start');
  assert.equal(input().value, '');
  assert.equal(sendButton(), null);
  assert.equal(messageText(articles('user').at(-1)), 'ciao mondo');

  const frames = new Set();
  await waitFor(() => {
    frames.add(lastReply());
    return settled();
  }, 'the run to finish');
  frames.delete('');
  assert.equal(lastReply(), 'Echo: ciao mondo');
  assert.ok(frames.size >= 2, `expected several streaming frames, saw ${[...frames].join(' | ')}`);
});

// Long enough (about 4 s of streaming) that Stop always lands before the reply is complete.
const longText = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');

await check(
  'Stop aborts the request mid-stream, and Enter does not send during the run',
  async () => {
    type(longText);
    await waitFor(() => !sendButton().disabled, 'send to enable');
    sendButton().click();
    await waitFor(() => lastReply().startsWith('Echo: word0'), 'the reply to stream');
    assert.equal(isRunning(), true);

    type('second message');
    const enter = pressEnter();
    assert.equal(enter.defaultPrevented, false);
    await sleep(50);
    assert.equal(articles('user').length, 3);
    assert.equal(input().value, 'second message');

    stopButton().click();
    await idle();
    assert.equal(chatRequests().at(-1).signal.aborted, true);
    const stopped = lastReply();
    assert.ok(stopped.length > 0 && `Echo: ${longText}`.startsWith(stopped), stopped);
    assert.notEqual(stopped, `Echo: ${longText}`);
    await sleep(300);
    assert.equal(lastReply(), stopped);
  },
);

await check('after Stop the thread accepts a new message, in order', async () => {
  await waitFor(() => !sendButton().disabled, 'send to enable after Stop');
  sendButton().click();
  await waitFor(() => lastReply() === 'Echo: second message', 'the next reply');
  await idle();
  assert.deepEqual(
    messages().map((m) => m.role),
    ['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant'],
  );
  assert.equal(messages()[6].text, 'second message');
});

await check(
  'the last reply always shows its actions, earlier messages on hover or focus',
  async () => {
    const bar = actionBar;
    const autohidden = (article) => bar(article).hasAttribute('data-nxa-autohidden');
    assert.ok(articles('user').every(autohidden));
    assert.equal(autohidden(lastAssistant()), false);
    const earlier = articles('assistant')[0];
    assert.equal(autohidden(earlier), true);
    assert.equal(bar(earlier).hidden, false, 'an auto-hidden bar stays in the tab order');
    earlier.dispatchEvent(new window.MouseEvent('mouseenter'));
    await waitFor(() => !autohidden(earlier), 'the hovered actions');
    earlier.dispatchEvent(new window.MouseEvent('mouseleave'));
    await waitFor(() => autohidden(earlier), 'the actions to hide again');

    // Tabbing into the hidden actions shows them.
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    button(earlier, 'Copy').focus();
    await waitFor(() => !autohidden(earlier), 'the focused actions');
    button(earlier, 'Copy').blur();
    await waitFor(() => autohidden(earlier), 'the actions to hide after the focus');
  },
);

await check('Regenerate adds a branch, and the branch picker moves between them', async () => {
  const reply = lastAssistant();
  assert.equal(reply.querySelector('[data-slot="branch-picker"]').hidden, true);
  button(reply, 'Regenerate').click();
  await waitFor(isRunning, 'the regeneration to start');
  await waitFor(() => actionBar(lastAssistant()).hidden, 'the actions to hide');
  await idle();
  assert.equal(lastReply(), 'Echo (2): second message');
  const picker = lastAssistant().querySelector('[data-slot="branch-picker"]');
  assert.equal(picker.hidden, false);
  assert.equal(branch(lastAssistant()), '2 / 2');

  lastAssistant().querySelector('[aria-label="Previous branch"]').click();
  await waitFor(() => branch(lastAssistant()) === '1 / 2', 'the first branch');
  assert.equal(lastReply(), 'Echo: second message');
  assert.equal(lastAssistant().querySelector('[aria-label="Previous branch"]').disabled, true);

  lastAssistant().querySelector('[aria-label="Next branch"]').click();
  await waitFor(() => branch(lastAssistant()) === '2 / 2', 'the second branch');
  assert.equal(lastReply(), 'Echo (2): second message');
});

await check('editing a message: Cancel keeps it, Save sends it as a new branch', async () => {
  const user = () => articles('user').at(-1);
  button(user(), 'Edit').click();
  const editor = () => user().querySelector('textarea[aria-label="Edit message"]');
  await waitFor(editor, 'the edit form');
  assert.equal(editor().value, 'second message');
  type('changed my mind', editor());
  button(user(), 'Cancel').click();
  await waitFor(() => !editor(), 'the edit to end');
  assert.equal(messageText(user()), 'second message');
  assert.equal(articles().length, 8);

  button(user(), 'Edit').click();
  await waitFor(editor, 'the edit form');
  type('second message, edited', editor());
  button(user(), 'Save').click();
  await waitFor(() => !editor(), 'the edit to end');
  await waitFor(isRunning, 'the edited run to start');
  await idle();
  assert.equal(messageText(user()), 'second message, edited');
  assert.equal(branch(user()), '2 / 2');
  assert.equal(lastReply(), 'Echo: second message, edited');

  user().querySelector('[aria-label="Previous branch"]').click();
  await waitFor(() => branch(user()) === '1 / 2', 'the original message');
  assert.equal(messageText(user()), 'second message');
  assert.equal(lastReply(), 'Echo (2): second message');
  user().querySelector('[aria-label="Next branch"]').click();
  await waitFor(() => branch(user()) === '2 / 2', 'the edited message');
});

await check('Copy writes the reply to the clipboard and shows it was copied', async () => {
  const copy = button(lastAssistant(), 'Copy');
  copy.click();
  await waitFor(() => copy.hasAttribute('data-nxa-copied'), 'the copied state');
  assert.deepEqual(clipboard, ['Echo: second message, edited']);
});

await check('dropped files become attachments that can be removed and sent', async () => {
  drop(
    new window.File(['some notes'], 'notes.txt', { type: 'text/plain' }),
    new window.File(['a,b'], 'table.csv', { type: 'text/csv' }),
    new window.File([new Uint8Array([137, 80, 78, 71])], 'dot.png', { type: 'image/png' }),
  );
  const rows = () => $$('[data-slot="composer-attachments"] nxa-attachment');
  await waitFor(() => rows().length === 3, 'three attachments in the composer');
  assert.deepEqual(rows().map(attachmentName), ['notes.txt', 'table.csv', 'dot.png']);
  assert.equal(text(rows()[0].querySelector('[nxaAttachmentThumb]')), '.txt');

  drop(new window.File(['%PDF'], 'paper.pdf', { type: 'application/pdf' }));
  const alert = () => chat().querySelector('nxa-composer > [role="alert"]');
  await waitFor(alert, 'the rejected file message');
  assert.equal(alert().getAttribute('role'), 'alert');
  assert.match(text(alert()), /^The file was not attached: /);
  assert.equal(rows().length, 3);

  rows()[1].querySelector('[aria-label="Remove table.csv"]').click();
  await waitFor(() => rows().length === 2, 'the attachment to go');
  await send('read this');
  assert.equal(rows().length, 0);
  assert.equal(alert(), null);
  const user = articles('user').at(-1);
  assert.deepEqual(
    [...user.querySelectorAll('[data-slot="user-message-attachments"] nxa-attachment')].map(
      attachmentName,
    ),
    ['notes.txt', 'dot.png'],
  );
  assert.equal(lastReply(), 'Echo: read this [attached: notes.txt, dot.png]');
  const sent = lastChatBody().messages.at(-1).content;
  assert.ok(sent.some((part) => part.type === 'file' && part.filename === 'dot.png'));
});

await check('a failed request shows its error until it runs again', async () => {
  await send('/error now');
  const alert = () => lastAssistant().querySelector('[role="alert"]');
  assert.equal(text(alert()), 'Status 500: The backend failed on purpose.');
  await run(async () => {
    button(lastAssistant(), 'Regenerate').click();
    await waitFor(() => alert() === null, 'the error to clear');
  });
  assert.equal(text(alert()), 'Status 500: The backend failed on purpose.');
});

await check('a stream that fails halfway keeps what it wrote and shows its error', async () => {
  await send('/error-stream now');
  assert.equal(lastReply(), 'Echo: /error-stream now');
  assert.equal(
    text(lastAssistant().querySelector('[role="alert"]')),
    'The stream failed on purpose.',
  );
});

await check(
  'New chat opens an empty conversation, and the first one keeps its history',
  async () => {
    const history = messages();
    newThread().click();
    await waitFor(() => welcome(), 'the new conversation');
    assert.deepEqual(threadTitles(), ['Hello there!']);
    assert.equal(activeTitle(), '');
    assert.equal(document.activeElement, input());

    openThread('Hello there!');
    await waitFor(() => activeTitle() === 'Hello there!', 'the first conversation');
    assert.deepEqual(messages(), history);
    assert.equal(document.activeElement, input());

    newThread().click();
    await waitFor(() => welcome(), 'the new conversation again');
    await waitFor(isCentered, 'the composer back in the middle');
  },
);

await check('a tool the backend runs shows its call, then its result', async () => {
  const from = requests.length;
  type('weather in Rome');
  await waitFor(() => !sendButton().disabled, 'send to enable');
  sendButton().click();
  await waitFor(() => $('[data-tool="get_weather"]'), 'the weather card');
  await idle();
  const card = $('[data-tool="get_weather"]');
  assert.equal(text(card.querySelector('[data-demo="tool-title"]')), 'Rome');
  const forecast = text(card.querySelector('[data-demo="tool-value"]'));
  const [, temperature, condition] = /^(\d+)°C, (\w+)$/.exec(forecast) ?? [];
  assert.ok(temperature && condition, forecast);
  assert.equal(lastReply(), `It is ${temperature}°C and ${condition} in Rome.`);
  assert.equal(chatRequests(from).length, 1);
  await waitFor(() => threadTitles()[0] === 'weather in Rome', 'the generated title');
  assert.deepEqual(threadTitles(), ['weather in Rome', 'Hello there!']);
});

await check('a tool that needs approval waits for the user: Deny', async () => {
  const from = requests.length;
  await send('send an email to ada@example.com');
  const card = () => $$('[data-tool="send_email"]').at(-1);
  assert.equal(card().dataset.answer, 'pending');
  assert.equal(text(card().querySelector('[data-demo="email-to"]')), 'ada@example.com');
  assert.equal(
    text(card().querySelector('[data-demo="email-subject"]')),
    'Hello from ngx-assistant',
  );
  assert.deepEqual([...card().querySelectorAll('button')].map(text), ['Deny', 'Approve']);
  assert.equal(isRunning(), false);
  assert.equal(chatRequests(from).length, 1);

  button(card(), 'Deny').click();
  await waitFor(() => lastReply() === 'Understood, I did not send the email.', 'the reply to Deny');
  await idle();
  assert.equal(card().dataset.answer, 'denied');
  assert.equal(button(card(), 'Approve'), undefined);
  const [first, second] = chatRequests(from);
  assert.ok(first && second);
  assert.deepEqual(second.body.messages.at(-1), {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: second.body.messages.at(-2).content[0].toolCallId,
        toolName: 'send_email',
        output: { type: 'json', value: { approved: false, to: 'ada@example.com' } },
      },
    ],
  });
});

await check('a tool that needs approval waits for the user: Approve', async () => {
  const from = requests.length;
  await send('send an email to bob@example.com');
  const card = () => $$('[data-tool="send_email"]').at(-1);
  const outcome = () => card().querySelector('[data-demo="tool-outcome"]');
  assert.equal(outcome().getAttribute('role'), 'status');
  assert.equal(text(outcome()), '');
  const approve = button(card(), 'Approve');
  approve.focus();
  approve.click();
  approve.click();
  await waitFor(() => lastReply() === 'Done: the email to bob@example.com is sent.', 'the reply');
  await idle();
  assert.equal(card().dataset.answer, 'approved');
  assert.equal(text(outcome()), 'Approved');
  // One answer reached the backend, and the focus moved from the button to the answer.
  assert.equal(chatRequests(from).length, 2);
  assert.equal(document.activeElement, outcome());
});

await check('a new message instead of an answer leaves the approval unanswered', async () => {
  await send('send an email to eve@example.com');
  const card = $$('[data-tool="send_email"]').at(-1);
  assert.equal(card.dataset.answer, 'pending');
  await send('never mind');
  assert.equal(lastReply(), 'Echo: never mind');
  assert.equal(card.dataset.answer, 'unanswered');
  assert.equal(text(card.querySelector('[data-demo="tool-outcome"]')), 'Not answered');
  assert.equal(card.querySelector('button'), null);
});

await check('the model picker sits in the composer, with an icon per model', async () => {
  assert.ok(picker().closest('[data-slot="composer-tools"]'), 'the picker is in the composer');
  assert.equal(modelTrigger().dataset.variant, 'ghost');
  assert.ok(modelTrigger().querySelector('[data-slot="model-selector-icon"] img'));

  const content = picker().querySelector('[data-slot="model-selector-content"]');
  modelTrigger().click();
  await waitFor(() => !content.hidden, 'the model list');
  const items = [...content.querySelectorAll('[data-slot="model-selector-item"]')];
  // The simulated models, then the free models of OpenRouter that answer in text, by name.
  assert.deepEqual(
    items.map((item) => text(item.querySelector('[data-slot="model-selector-item-name"]'))),
    ['Echo', 'Shout', 'Acme: Unknown 1', 'Google: Gemma 4 31B', 'OpenAI: gpt-oss-20b'],
  );
  const icon = (item) => item.querySelector('[data-slot="model-selector-icon"]');
  assert.ok(items.every(icon));
  assert.match(icon(items[2]).querySelector('img').src, /^data:image\/svg\+xml,/);
  assert.match(icon(items[3]).querySelector('img').src, /\/providers\/gemma-color\.svg$/);
  // A one-color logo takes the color of the text, for the dark theme.
  assert.equal(icon(items[4]).querySelector('img'), null);
  assert.ok(icon(items[4]).querySelector('[data-demo="model-icon-mask"]'));
  for (const item of items.slice(2)) {
    assert.equal(item.getAttribute('aria-disabled'), 'true');
    assert.ok(text(item).includes('Connect OpenRouter to use'), text(item));
  }
  items[3].click();
  await sleep(50);
  assert.equal(content.hidden, false, 'a disabled model keeps the list open');
  assert.equal(modelTrigger().getAttribute('aria-label'), 'Model: Echo');
  modelTrigger().click();
  await waitFor(() => content.hidden, 'the model list to close');
});

await check('the model picker sends the model and its effort with every run', async () => {
  await pickModel('Shout');
  assert.equal(modelTrigger().getAttribute('aria-label'), 'Model: Shout');
  await send('quiet please');
  assert.equal(lastReply(), 'ECHO: QUIET PLEASE');
  assert.equal(lastChatBody().modelName, 'shout');
  assert.equal(lastChatBody().reasoningEffort, undefined);

  await pickModel('Echo', 'High');
  assert.equal(modelTrigger().getAttribute('aria-label'), 'Model: Echo, High effort');
  await send('think first');
  // The reasoning closes once the answer starts, and opens again on demand.
  const toggle = lastAssistant().querySelector('[data-slot="reasoning-trigger"]');
  assert.equal(text(toggle), 'Reasoning');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.click();
  await waitFor(
    () => lastAssistant().querySelector('[data-slot="reasoning-text"]'),
    'the reasoning to open',
  );
  assert.equal(
    text(lastAssistant().querySelector('[data-slot="reasoning-text"]')),
    'Thinking with high effort.',
  );
  assert.equal(lastReply(), 'Echo: think first');
  assert.equal(lastChatBody().modelName, 'echo');
  assert.equal(lastChatBody().reasoningEffort, 'high');
  await pickModel('Shout');
});

await check('a run goes on while another conversation is shown', async () => {
  const words = Array.from({ length: 12 }, (_, i) => `step${i}`).join(' ');
  type(words);
  await waitFor(() => !sendButton().disabled, 'send to enable');
  sendButton().click();
  await waitFor(() => lastReply().startsWith('ECHO: STEP0'), 'the reply to stream');

  openThread('Hello there!');
  await waitFor(() => activeTitle() === 'Hello there!', 'the other conversation');
  assert.equal(isRunning(), false);
  assert.equal(messageText(articles('user')[0]), 'Hello there!');
  await waitFor(
    () =>
      stored().messages['thread-2'].items.some(
        (i) =>
          i.message.status?.type === 'complete' &&
          i.message.content.some((p) => p.text === `ECHO: ${words.toUpperCase()}`),
      ),
    'the run to finish in the background',
  );

  openThread('weather in Rome');
  await waitFor(() => activeTitle() === 'weather in Rome', 'the conversation back');
  assert.equal(lastReply(), `ECHO: ${words.toUpperCase()}`);
  assert.equal(isRunning(), false);
});

await check('no errors were reported other than the failures asked for', async () => {
  // The runtime logs the regeneration that fails on purpose, above.
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], /Message reload failed.*Status 500: The backend failed on purpose\./);
});

const saved = { 'ngx-assistant-demo': window.localStorage.getItem('ngx-assistant-demo') };
window.close();
openPage(saved);

await check('a reload brings back the conversations, their tools and their state', async () => {
  await waitFor(() => chat() && threadTitles().length === 2, 'the saved conversations');
  assert.deepEqual(threadTitles(), ['weather in Rome', 'Hello there!']);
  assert.deepEqual(requests.map((r) => `${r.method} ${r.path}`).sort(), [
    'GET /api/models',
    'GET /api/threads',
  ]);

  openThread('weather in Rome');
  await waitFor(() => articles().length > 0, 'the saved messages');
  assert.deepEqual(
    messages()
      .filter((m) => m.role === 'user')
      .map((m) => m.text),
    [
      'weather in Rome',
      'send an email to ada@example.com',
      'send an email to bob@example.com',
      'send an email to eve@example.com',
      'never mind',
      'quiet please',
      'think first',
      Array.from({ length: 12 }, (_, i) => `step${i}`).join(' '),
    ],
  );
  assert.match(text($('[data-tool="get_weather"] [data-demo="tool-value"]')), /^\d+°C, \w+$/);
  assert.deepEqual(
    $$('[data-tool="send_email"]').map((card) => card.dataset.answer),
    ['denied', 'approved', 'unanswered'],
  );
  assert.deepEqual(
    requests.filter((r) => r.path !== '/api/models').map((r) => `${r.method} ${r.path}`),
    ['GET /api/threads', 'GET /api/threads/thread-2/messages'],
  );
});

await check('a reload brings back the branches, a stopped reply and the errors', async () => {
  openThread('Hello there!');
  await waitFor(() => activeTitle() === 'Hello there!' && articles().length > 0, 'the messages');
  const users = articles('user');
  assert.deepEqual(users.slice(0, 4).map(messageText), [
    'Hello there!',
    'ciao mondo',
    longText,
    'second message, edited',
  ]);
  assert.equal(branch(users[3]), '2 / 2');
  const stopped = messageText(articles('assistant')[2]);
  assert.ok(stopped.startsWith('Echo: word0') && stopped !== `Echo: ${longText}`, stopped);
  assert.equal(
    text(lastAssistant().querySelector('[role="alert"]')),
    'The stream failed on purpose.',
  );
  assert.equal(lastReply(), 'Echo: /error-stream now');

  users[3].querySelector('[aria-label="Previous branch"]').click();
  await waitFor(() => branch(articles('user')[3]) === '1 / 2', 'the original message');
  assert.equal(messageText(articles('user')[3]), 'second message');
  // Off the head, a branch opens on whichever take the runtime picks: both are there.
  assert.match(branch(articles('assistant')[3]), /^[12] \/ 2$/);
});

await check('renaming, archiving, restoring and deleting from the row menu', async () => {
  const item = (title) => threadItems().find((i) => itemTitle(i) === title);
  await threadAction(item('weather in Rome'), 'Rename');
  const rename = () => sidebar().querySelector('[data-slot="thread-list-item-rename"]');
  await waitFor(rename, 'the rename input');
  type('Forecasts', rename());
  pressEnter({}, rename());
  await waitFor(() => item('Forecasts'), 'the renamed conversation');
  await waitFor(() => stored().threads['thread-2'].title === 'Forecasts', 'the saved title');

  await threadAction(item('Hello there!'), 'Archive');
  await waitFor(() => threadItems().length === 1, 'the archived conversation to leave the list');
  assert.deepEqual(threadTitles(), ['Forecasts']);
  // The archived conversation is no longer shown.
  assert.notEqual(activeTitle(), 'Hello there!');
  await waitFor(() => stored().threads['thread-1'].status === 'archived', 'the saved archive');
  await showArchived();
  assert.deepEqual(archivedItems().map(itemTitle), ['Hello there!']);

  await threadAction(archivedItems()[0], 'Restore');
  await waitFor(() => threadItems().length === 2, 'the restored conversation');
  assert.equal(archivedItems().length, 0);
  openThread('Hello there!');
  await waitFor(() => activeTitle() === 'Hello there!', 'the restored conversation shown');
  assert.equal(messageText(articles('user')[0]), 'Hello there!');
  await waitFor(() => stored().threads['thread-1'].status === 'regular', 'the saved restore');

  await threadAction(item('Hello there!'), 'Archive');
  await showArchived();
  await threadAction(archivedItems()[0], 'Delete');
  await waitFor(() => archivedItems().length === 0, 'the deleted conversation');
  assert.deepEqual(threadTitles(), ['Forecasts']);
  await waitFor(() => !stored().threads['thread-1'], 'the conversation deleted on the backend');
  assert.equal(stored().messages['thread-1'], undefined);
});

await check('on a narrow screen the conversations open over the thread, and close', async () => {
  const toggle = document.querySelector('[data-demo="sidebar-toggle"]');
  const aside = document.getElementById(toggle.getAttribute('aria-controls'));
  const open = () => toggle.getAttribute('aria-expanded') === 'true';
  assert.equal(open(), false);
  assert.ok(aside.classList.contains('hidden'));
  toggle.click();
  await waitFor(open, 'the conversations to open');
  assert.ok(aside.classList.contains('flex') && !aside.classList.contains('hidden'));

  // Escape closes them, back to the button.
  newThread().focus();
  pressEnter({ key: 'Escape' }, newThread());
  await waitFor(() => !open(), 'the conversations to close');
  assert.equal(document.activeElement, toggle);

  // Picking a conversation shows it.
  toggle.click();
  await waitFor(open, 'the conversations to open again');
  openThread('Forecasts');
  await waitFor(() => !open(), 'the conversations to close on a pick');
  assert.ok(aside.classList.contains('hidden'));
});

const layoutButton = (name) =>
  button(document.querySelector('[role="group"][aria-label="Layout"]'), name);

await check('the widget layout shows the conversations in the assistant modal', async () => {
  openThread('Forecasts');
  await waitFor(() => activeTitle() === 'Forecasts', 'the conversation');
  layoutButton('widget').click();
  await waitFor(() => !sidebar(), 'the page layout to go');
  const launcher = () => document.querySelector('[data-slot="assistant-modal-button"]');
  await waitFor(launcher, 'the launcher');
  assert.equal(chat(), null);

  launcher().click();
  await waitFor(chat, 'the thread in the modal');
  assert.equal(launcher().getAttribute('aria-expanded'), 'true');
  assert.equal(text(document.querySelector('[data-slot="assistant-modal-title"]')), 'Forecasts');
  assert.ok(
    document.querySelector(
      '[data-slot="assistant-modal-content"] [data-slot="composer-tools"] nxa-model-selector',
    ),
    'the model picker is in the composer of the modal',
  );
  await send('from the widget');
  assert.equal(lastReply(), 'Echo: from the widget');

  // Escape from inside closes it, and the focus goes back to the launcher.
  input().focus();
  pressEnter({ key: 'Escape' });
  await waitFor(() => !chat(), 'the modal to close');
  assert.equal(launcher().getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, launcher());

  layoutButton('page').click();
  await waitFor(() => sidebar() && chat(), 'the page layout');
  assert.equal(lastReply(), 'Echo: from the widget');
});

await check('the theme toggle switches the page to dark and back', async () => {
  const toggle = document.querySelector('[data-demo="theme-toggle"]');
  const root = document.documentElement;
  const dark = toggle.getAttribute('aria-pressed') === 'true';
  toggle.click();
  await waitFor(() => root.classList.contains('dark') === !dark, 'the theme to change');
  assert.equal(root.classList.contains('light'), dark);
  assert.equal(toggle.getAttribute('aria-pressed'), String(!dark));
  toggle.click();
  await waitFor(() => root.classList.contains('dark') === dark, 'the theme back');
  assert.deepEqual(errors, []);
});

// The free models of OpenRouter, on a new page with nothing saved.
window.close();
openPage();

const panelToggle = () => document.querySelector('[data-demo="openrouter-toggle"]');
const panel = () => document.getElementById('demo-openrouter-panel');
const connectLink = () => panel().querySelector('[data-demo="openrouter-connect"]');
const panelError = () => text(panel().querySelector('[data-demo="openrouter-error"]'));
const chatCalls = () => openRouterCalls.filter((c) => c.path === '/api/v1/chat/completions');
const lastCall = () => chatCalls().at(-1);
const KEY = 'ngx-assistant-demo-openrouter-key';
const SIGN_IN = 'ngx-assistant-demo-openrouter-sign-in';

async function openPanel() {
  if (panelToggle().getAttribute('aria-expanded') !== 'true') panelToggle().click();
  await waitFor(() => !panel().hidden, 'the OpenRouter panel');
}

async function pasteKey(key) {
  await openPanel();
  const field = panel().querySelector('#demo-openrouter-key');
  field.value = key;
  panel().querySelector('form').requestSubmit();
  await waitFor(() => panel().querySelector('[data-demo="openrouter-disconnect"]'), 'the account');
}

await check('Connect OpenRouter goes to its sign-in with a PKCE challenge', async () => {
  await waitFor(() => chat() && input() && panelToggle(), 'the app to mount');
  assert.equal(text(panelToggle()), 'OpenRouter (not connected)');
  assert.equal(panel().hidden, true);
  await openPanel();
  assert.equal(panelToggle().getAttribute('aria-expanded'), 'true');
  await waitFor(() => connectLink().getAttribute('href'), 'the sign-in address');
  const url = new URL(connectLink().href);
  assert.equal(`${url.origin}${url.pathname}`, 'https://openrouter.ai/auth');
  assert.equal(url.searchParams.get('callback_url'), 'http://localhost/');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const pending = JSON.parse(window.sessionStorage.getItem(SIGN_IN));
  assert.equal(url.searchParams.get('state'), pending.state);
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(pending.verifier),
  );
  assert.equal(url.searchParams.get('code_challenge'), Buffer.from(digest).toString('base64url'));
  // Escape closes the panel, back to its button.
  panel().querySelector('input').focus();
  panel().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await waitFor(() => panel().hidden, 'the panel to close');
  assert.equal(document.activeElement, panelToggle());
});

await check('a model of OpenRouter without an account fails with a reason', async () => {
  // As a client that skips the disabled entry would: the backend asks for the account.
  const response = await window.fetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      modelName: 'openrouter/google/gemma-4-31b-it:free',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    }),
  });
  assert.equal(response.status, 401);
  assert.equal(await response.text(), 'Connect OpenRouter to use this model.');
  assert.deepEqual(chatCalls(), []);
});

await check(
  'a pasted key enables the free models, and the reply streams from OpenRouter',
  async () => {
    await pasteKey('  sk-or-pasted  ');
    assert.equal(window.localStorage.getItem(KEY), 'sk-or-pasted');
    assert.equal(text(panelToggle()), 'OpenRouter (connected)');
    assert.equal(document.activeElement, panelToggle());
    panelToggle().click();

    await pickModel('Google: Gemma 4 31B', 'High');
    assert.equal(
      modelTrigger().getAttribute('aria-label'),
      'Model: Google: Gemma 4 31B, High effort',
    );
    openRouterChat = (call) =>
      sse(
        [
          delta({ reasoning: 'The user ' }),
          delta({ reasoning: 'says hi.' }),
          ...words('Hi! I am Gemma, on OpenRouter.'),
          delta({}, 'stop'),
        ],
        call.signal,
      );
    // The first message of the page starts its conversation: wait for the run itself.
    type('Hi there');
    await waitFor(() => sendButton() && !sendButton().disabled, 'send to enable');
    sendButton().click();
    await waitFor(isRunning, 'the run to start');
    await idle();
    assert.equal(lastReply(), 'Hi! I am Gemma, on OpenRouter.');
    const toggle = lastAssistant().querySelector('[data-slot="reasoning-trigger"]');
    toggle.click();
    await waitFor(
      () => lastAssistant().querySelector('[data-slot="reasoning-text"]'),
      'the reasoning to open',
    );
    assert.equal(
      text(lastAssistant().querySelector('[data-slot="reasoning-text"]')),
      'The user says hi.',
    );

    // The client sent the key to its backend, which sent it on to OpenRouter.
    assert.equal(chatRequests().at(-1).body.modelName, 'openrouter/google/gemma-4-31b-it:free');
    const call = lastCall();
    assert.equal(call.authorization, 'Bearer sk-or-pasted');
    assert.equal(call.body.model, 'google/gemma-4-31b-it:free');
    assert.equal(call.body.stream, true);
    assert.deepEqual(call.body.reasoning, { effort: 'high' });
    assert.deepEqual(
      call.body.tools.map((t) => t.function.name),
      ['get_weather', 'send_email'],
    );
    assert.equal(call.body.messages[0].role, 'system');
    assert.deepEqual(call.body.messages.slice(1), [
      { role: 'user', content: [{ type: 'text', text: 'Hi there' }] },
    ]);
    // The models list was read once for the page.
    assert.equal(openRouterCalls.filter((c) => c.path === '/api/v1/models').length, 1);
  },
);

await check(
  'get_weather runs on the backend, which gives the result back to the model',
  async () => {
    openRouterChat = (call, n) => {
      const last = call.body.messages.at(-1);
      if (last.role === 'tool') {
        const forecast = JSON.parse(last.content);
        return sse(words(`It is ${forecast.temperature}°C in ${forecast.city}.`), call.signal);
      }
      return sse(
        [
          delta({
            tool_calls: [
              { index: 0, id: `call_${n}`, function: { name: 'get_weather', arguments: '{"ci' } },
            ],
          }),
          delta({ tool_calls: [{ index: 0, function: { arguments: 'ty":"Rome"}' } }] }),
          delta({}, 'tool_calls'),
        ],
        call.signal,
      );
    };
    const from = chatCalls().length;
    await send('What is the weather in Rome?');
    const card = $$('[data-tool="get_weather"]').at(-1);
    assert.equal(text(card.querySelector('[data-demo="tool-title"]')), 'Rome');
    const forecast = text(card.querySelector('[data-demo="tool-value"]'));
    const [, temperature, condition] = /^(\d+)°C, (\w+)$/.exec(forecast);
    assert.equal(lastReply(), `It is ${temperature}°C in Rome.`);

    const [first, second] = chatCalls().slice(from);
    assert.equal(chatCalls().length, from + 2);
    assert.deepEqual(second.body.messages.slice(first.body.messages.length), [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: `call_${from + 1}`,
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Rome"}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: `call_${from + 1}`,
        content: JSON.stringify({ city: 'Rome', temperature: Number(temperature), condition }),
      },
    ]);
  },
);

await check('send_email waits for the user, and the answer goes back to the model', async () => {
  openRouterChat = (call) => {
    const last = call.body.messages.at(-1);
    if (last.role === 'tool') {
      const answer = JSON.parse(last.content);
      return sse(words(answer.approved ? 'The email is sent.' : 'Not sent.'), call.signal);
    }
    return sse(
      [
        delta({ content: 'Let me send it.' }),
        delta({
          tool_calls: [
            {
              index: 0,
              id: 'call_email',
              function: {
                name: 'send_email',
                arguments: '{"to":"ada@example.com","subject":"Hi"}',
              },
            },
          ],
        }),
        delta({}, 'tool_calls'),
      ],
      call.signal,
    );
  };
  const from = chatCalls().length;
  await send('Email Ada');
  const card = () => $$('[data-tool="send_email"]').at(-1);
  assert.equal(card().dataset.answer, 'pending');
  assert.equal(text(card().querySelector('[data-demo="email-to"]')), 'ada@example.com');
  assert.equal(chatCalls().length, from + 1);
  button(card(), 'Approve').click();
  await waitFor(() => lastReply().endsWith('The email is sent.'), 'the reply after the answer');
  await idle();
  const call = lastCall();
  assert.deepEqual(call.body.messages.at(-2).tool_calls[0].function, {
    name: 'send_email',
    arguments: '{"to":"ada@example.com","subject":"Hi"}',
  });
  assert.deepEqual(call.body.messages.at(-1), {
    role: 'tool',
    tool_call_id: 'call_email',
    content: JSON.stringify({ approved: true, to: 'ada@example.com' }),
  });
});

await check('get_weather, then send_email: Approve reaches the model, in one reply', async () => {
  openRouterChat = (call) => {
    const last = call.body.messages.at(-1);
    if (last.role === 'tool' && last.tool_call_id === 'call_mail') {
      return sse(words('Mailed the forecast.'), call.signal);
    }
    if (last.role === 'tool') {
      return sse(
        [
          delta({
            tool_calls: [
              {
                index: 0,
                id: 'call_mail',
                function: {
                  name: 'send_email',
                  arguments: '{"to":"b@example.com","subject":"Oslo"}',
                },
              },
            ],
          }),
          delta({}, 'tool_calls'),
        ],
        call.signal,
      );
    }
    return sse(
      [
        delta({ content: 'Checking.' }),
        delta({
          tool_calls: [
            {
              index: 0,
              id: 'call_oslo',
              function: { name: 'get_weather', arguments: '{"city":"Oslo"}' },
            },
          ],
        }),
        delta({}, 'tool_calls'),
      ],
      call.signal,
    );
  };
  const from = chatCalls().length;
  await send('Weather in Oslo, and email it to b@example.com');
  assert.equal(chatCalls().length, from + 2);
  // The text of the step goes back with its tool call.
  assert.equal(chatCalls().at(-1).body.messages.at(-2).content, 'Checking.');
  const card = () => $$('[data-tool="send_email"]').at(-1);
  assert.equal(card().dataset.answer, 'pending');
  button(card(), 'Approve').click();
  await waitFor(() => lastReply().endsWith('Mailed the forecast.'), 'the reply after the answer');
  await idle();
  assert.equal(chatCalls().length, from + 3);
  const tools = lastCall().body.messages.filter((m) => m.role === 'tool');
  assert.deepEqual(
    tools.slice(-2).map((m) => m.tool_call_id),
    ['call_oslo', 'call_mail'],
  );
});

await check('tool calls without ids, a repeated name and an unknown tool', async () => {
  openRouterChat = (call) => {
    const last = call.body.messages.at(-1);
    if (last.role === 'tool') return sse(words('Done with the tools.'), call.signal);
    return sse(
      [
        delta({ tool_calls: [{ function: { name: 'get_weather', arguments: '{"city":' } }] }),
        delta({ tool_calls: [{ function: { name: 'get_weather', arguments: '"Bari"}' } }] }),
        delta({ tool_calls: [{ index: 1, function: { name: 'read_mind', arguments: '{}' } }] }),
        delta({}, 'tool_calls'),
      ],
      call.signal,
    );
  };
  await send('tools please');
  assert.equal(lastReply(), 'Done with the tools.');
  const calls = lastCall().body.messages.at(-3).tool_calls;
  assert.deepEqual(
    calls.map((c) => [c.function.name, c.function.arguments]),
    [
      ['get_weather', '{"city":"Bari"}'],
      ['read_mind', '{}'],
    ],
  );
  assert.ok(
    calls.every((c) => /^call-or-[\w-]{36}$/.test(c.id)),
    JSON.stringify(calls),
  );
  assert.deepEqual(JSON.parse(lastCall().body.messages.at(-1).content), {
    error: 'There is no tool named read_mind.',
  });
  const card = $$('[data-tool="get_weather"]').at(-1);
  assert.equal(text(card.querySelector('[data-demo="tool-title"]')), 'Bari');
});

await check('a failed call after a tool keeps the reply and shows the reason', async () => {
  openRouterChat = (call) =>
    call.body.messages.at(-1).role === 'tool'
      ? new Response('Upstream down', { status: 502 })
      : sse(
          [
            delta({
              tool_calls: [
                {
                  index: 0,
                  id: 'call_x',
                  function: { name: 'get_weather', arguments: '{"city":"Pisa"}' },
                },
              ],
            }),
            delta({}, 'tool_calls'),
          ],
          call.signal,
        );
  await send('weather in Pisa');
  assert.ok($$('[data-tool="get_weather"]').at(-1));
  assert.equal(text(lastAssistant().querySelector('[role="alert"]')), 'OpenRouter: Upstream down');
});

await check('images go to a model that takes them, a note to one that does not', async () => {
  openRouterChat = (call) => sse(words('A dot.'), call.signal);
  drop(new window.File([new Uint8Array([137, 80, 78, 71])], 'dot.png', { type: 'image/png' }));
  await waitFor(
    () => $$('[data-slot="composer-attachments"] nxa-attachment').length === 1,
    'the image',
  );
  await send('what is this?');
  const user = lastCall().body.messages.at(-1);
  assert.equal(
    user.content.find((p) => p.type === 'image_url')?.image_url.url.slice(0, 22),
    'data:image/png;base64,',
  );

  await pickModel('OpenAI: gpt-oss-20b');
  await send('and now?');
  const earlier = lastCall().body.messages.at(-3);
  assert.ok(
    earlier.content.some(
      (p) => p.type === 'text' && p.text === '[dot.png is attached, but this model cannot read it]',
    ),
    JSON.stringify(earlier),
  );
  await pickModel('Google: Gemma 4 31B');
});

await check('a model without tools gets the conversation without them', async () => {
  openRouterChat = (call) => sse(words('Plain answer.'), call.signal);
  await pickModel('OpenAI: gpt-oss-20b');
  await send('And now?');
  assert.equal(lastReply(), 'Plain answer.');
  const call = lastCall();
  assert.equal(call.body.model, 'openai/gpt-oss-20b:free');
  assert.equal(call.body.tools, undefined);
  assert.equal(call.body.reasoning, undefined);
  assert.equal(call.body.messages.filter((m) => m.role === 'tool' || m.tool_calls).length, 0);
  assert.deepEqual(call.body.messages.at(-1), {
    role: 'user',
    content: [{ type: 'text', text: 'And now?' }],
  });
});

await check('OpenRouter refusing the request shows its reason', async () => {
  openRouterChat = () =>
    Response.json(
      { error: { code: 429, message: 'Rate limit exceeded: free-models-per-day' } },
      { status: 429 },
    );
  await send('one more');
  assert.equal(
    text(lastAssistant().querySelector('[role="alert"]')),
    'Status 429: OpenRouter: Rate limit exceeded: free-models-per-day',
  );
});

await check('an error in the middle of the stream keeps the text and shows the error', async () => {
  openRouterChat = (call) =>
    sse(
      [...words('Partial'), { error: { code: 502, message: 'Provider returned error' } }],
      call.signal,
    );
  await send('and again');
  assert.equal(lastReply(), 'Partial');
  assert.equal(
    text(lastAssistant().querySelector('[role="alert"]')),
    'OpenRouter: Provider returned error',
  );
});

await check('Stop aborts the request to OpenRouter', async () => {
  openRouterChat = (call) => sse(words('word '.repeat(200)), call.signal, 20);
  type('a long one');
  await waitFor(() => !sendButton().disabled, 'send to enable');
  sendButton().click();
  await waitFor(() => lastReply().startsWith('word'), 'the reply to stream');
  stopButton().click();
  await idle();
  const call = lastCall();
  assert.equal(call.signal.aborted, true);
  assert.ok(lastReply().length < 'word '.repeat(200).trim().length);
});

await check('Disconnect forgets the key, and the picked model gives way to Echo', async () => {
  await openPanel();
  const disconnect = panel().querySelector('[data-demo="openrouter-disconnect"]');
  disconnect.focus();
  disconnect.click();
  await waitFor(() => connectLink(), 'the account to go');
  assert.equal(document.activeElement, panelToggle());
  assert.equal(window.localStorage.getItem(KEY), null);
  // The effort picked for Gemma stays, and Echo has efforts too.
  await waitFor(
    () => modelTrigger().getAttribute('aria-label') === 'Model: Echo, High effort',
    'Echo',
  );
  panelToggle().click();
  const from = chatCalls().length;
  await send('offline again');
  assert.equal(lastReply(), 'Echo: offline again');
  assert.equal(chatCalls().length, from);
  assert.equal(chatRequests().at(-1).body.modelName, 'echo');
});

await check('no errors were reported on the OpenRouter page', async () => {
  assert.deepEqual(errors, []);
});

await check('back from the sign-in, the code becomes a key and leaves the address', async () => {
  window.close();
  const pending = JSON.stringify({ verifier: 'the-verifier', state: 'the-state' });
  openPage({}, 'http://localhost/?code=the-code&state=the-state', { [SIGN_IN]: pending });
  await waitFor(() => chat() && panelToggle(), 'the app to mount');
  await waitFor(() => window.localStorage.getItem(KEY) === 'sk-or-from-sign-in', 'the key');
  assert.equal(window.location.href, 'http://localhost/');
  assert.equal(window.sessionStorage.getItem(SIGN_IN), null);
  const exchange = openRouterCalls.filter((c) => c.path === '/api/v1/auth/keys');
  assert.deepEqual(
    exchange.map((c) => [c.method, c.body]),
    [['POST', { code: 'the-code', code_verifier: 'the-verifier', code_challenge_method: 'S256' }]],
  );
  await waitFor(() => text(panelToggle()) === 'OpenRouter (connected)', 'the account');
  assert.deepEqual(errors, []);
});

await check('a code without the sign-in that asked for it is not exchanged', async () => {
  window.close();
  const pending = JSON.stringify({ verifier: 'the-verifier', state: 'the-state' });
  openPage({}, 'http://localhost/?code=the-code&state=another-state', { [SIGN_IN]: pending });
  await waitFor(() => chat() && panelToggle(), 'the app to mount');
  await openPanel();
  await waitFor(() => panelError(), 'the error');
  assert.equal(panelError(), 'The OpenRouter sign-in did not start here. Try Connect again.');
  assert.equal(window.location.href, 'http://localhost/');
  assert.equal(window.localStorage.getItem(KEY), null);
  assert.deepEqual(
    openRouterCalls.filter((c) => c.path === '/api/v1/auth/keys'),
    [],
  );
});

await check('when OpenRouter cannot list its models, the simulated ones remain', async () => {
  window.close();
  openRouterModels = () => new Response('Service unavailable', { status: 503 });
  openPage();
  await waitFor(() => chat() && panelToggle(), 'the app to mount');
  await openPanel();
  await waitFor(() => panelError(), 'the error');
  assert.equal(panelError(), 'Could not load the OpenRouter models: OpenRouter answered 503');
  const content = picker().querySelector('[data-slot="model-selector-content"]');
  modelTrigger().click();
  await waitFor(() => !content.hidden, 'the model list');
  assert.deepEqual(
    [...content.querySelectorAll('[data-slot="model-selector-item-name"]')].map(text),
    ['Echo', 'Shout'],
  );
  openRouterModels = catalogResponse;
});

console.log(`\n${checks.length} checks passed`);
window.close();
