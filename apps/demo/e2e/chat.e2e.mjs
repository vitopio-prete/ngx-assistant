// End-to-end check of the production demo bundle in jsdom, against the backend it ships: the
// thread, its branches, editing, regenerating, copying, attachments, errors, suggestions, tool
// calls with an approval, the model picker, the thread list, and what a reload brings back.
// Every request to the backend is recorded and checked.
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
/** What the copy buttons wrote. */
let clipboard = [];
let window;
let document;

/** Opens the demo in a new page; `storage` is the `localStorage` it starts with. */
function openPage(storage = {}) {
  errors = [];
  requests = [];
  clipboard = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.forwardTo(console, { jsdomErrors: 'none' });
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  virtualConsole.on('error', (...args) => errors.push(args.map(String).join(' ')));
  virtualConsole.on('warn', (...args) => errors.push(args.map(String).join(' ')));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
    virtualConsole,
  });
  window = dom.window;
  document = window.document;
  window.addEventListener('error', (e) => errors.push(e.message));
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);

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

  // jsdom has no fetch: the page installs its backend as `fetch`, and this records each call.
  let backend;
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    get: () => record,
    set: (fetch) => void (backend = fetch),
  });
  function record(input, init = {}) {
    const url = new URL(String(input), window.location.href);
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (element) => element?.textContent.replace(/\s+/g, ' ').trim() ?? '';

const chat = () => document.querySelector('nxa-demo-chat');
const $ = (selector) => chat().querySelector(selector);
const $$ = (selector) => [...chat().querySelectorAll(selector)];
const input = () => $('textarea[aria-label="Message"]');
const sendButton = () => $('.composer .primary');
const stopButton = () => $('.composer .secondary');
const isRunning = () => stopButton() !== null;
const articles = (role) => $$(`article${role ? `[data-role="${role}"]` : ''}`);
const messageText = (article) => text(article.querySelector('.bubble'));
const messages = () =>
  articles().map((article) => ({ role: article.dataset.role, text: messageText(article) }));
const lastAssistant = () => articles('assistant').at(-1);
const lastReply = () => (lastAssistant() ? messageText(lastAssistant()) : '');
const lastText = () =>
  lastAssistant() ? [...lastAssistant().querySelectorAll('.text')].map(text).join(' ') : '';
const branch = (article) => text(article.querySelector('.branch-label'));
const button = (root, label) => [...root.querySelectorAll('button')].find((b) => text(b) === label);

const sidebar = () => document.querySelector('nxa-demo-thread-sidebar');
const threadItems = () => [...sidebar().querySelectorAll('.thread-list > .thread-item')];
const archivedItems = () => [...sidebar().querySelectorAll('.archived .thread-item')];
const threadTitles = () => threadItems().map((item) => text(item.querySelector('.thread-trigger')));
const activeTitle = () =>
  text(sidebar().querySelector('.thread-item[data-active] .thread-trigger'));
const openThread = (title) =>
  threadItems()
    .find((item) => text(item.querySelector('.thread-trigger')) === title)
    .querySelector('.thread-trigger')
    .click();

const picker = () => document.querySelector('nxa-demo-model-picker');
const modelTrigger = () => picker().querySelector('.model-trigger');

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

const idle = () => waitFor(() => !isRunning(), 'the run to finish');

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
  $('.composer').dispatchEvent(event);
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

/** Picks a model in the header, then its effort level when given. */
async function pickModel(name, effort) {
  const content = picker().querySelector('.model-content');
  const open = async () => {
    modelTrigger().click();
    await waitFor(() => !content.hidden, 'the model list');
  };
  await open();
  [...content.querySelectorAll('.model-item')]
    .find((item) => text(item.querySelector('strong')) === name)
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
  await waitFor(() => requests.length > 0, 'the thread list to load');
  assert.deepEqual(
    requests.map((r) => `${r.method} ${r.path}`),
    ['GET /api/threads'],
  );
  assert.deepEqual(threadTitles(), []);
  assert.equal(sidebar().querySelector('.new-thread').dataset.active, 'true');
  await waitFor(() => $('.welcome'), 'the welcome screen');
  assert.deepEqual(
    $$('.suggestion').map((s) => text(s.querySelector('strong'))),
    ['Say hello', 'Check the weather', 'Send an email', 'Show an error'],
  );
  assert.equal(text(modelTrigger()), 'Echo');
  assert.equal(sendButton().disabled, true);
  assert.equal(isRunning(), false);
  assert.deepEqual(messages(), []);
  assert.equal(document.activeElement, input());
});

await check('the first message saves the conversation, which the backend names', async () => {
  $$('.suggestion')[0].click();
  await waitFor(isRunning, 'the run to start');
  await idle();
  assert.deepEqual(messages(), [
    { role: 'user', text: 'Hello there!' },
    { role: 'assistant', text: 'Echo: Hello there!' },
  ]);
  assert.equal($('.welcome'), null);
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
    return !isRunning();
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

await check('user messages always show their actions, earlier replies on hover', async () => {
  const bar = (article) => article.querySelector('.action-bar');
  assert.ok(articles('user').every((article) => !bar(article).hidden));
  assert.equal(bar(lastAssistant()).hidden, false);
  const earlier = articles('assistant')[0];
  assert.equal(bar(earlier).hidden, true);
  earlier.dispatchEvent(new window.MouseEvent('mouseenter'));
  await waitFor(() => !bar(earlier).hidden, 'the hovered actions');
  earlier.dispatchEvent(new window.MouseEvent('mouseleave'));
  await waitFor(() => bar(earlier).hidden, 'the actions to hide again');
});

await check('Regenerate adds a branch, and the branch picker moves between them', async () => {
  const reply = lastAssistant();
  assert.equal(reply.querySelector('.branch-picker').hidden, true);
  button(reply, 'Regenerate').click();
  await waitFor(isRunning, 'the regeneration to start');
  await waitFor(() => lastAssistant().querySelector('.action-bar').hidden, 'the actions to hide');
  await idle();
  assert.equal(lastReply(), 'Echo (2): second message');
  const picker = lastAssistant().querySelector('.branch-picker');
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
  assert.equal(text(copy), 'Copied');
  assert.deepEqual(clipboard, ['Echo: second message, edited']);
});

await check('dropped files become attachments that can be removed and sent', async () => {
  drop(
    new window.File(['some notes'], 'notes.txt', { type: 'text/plain' }),
    new window.File(['a,b'], 'table.csv', { type: 'text/csv' }),
    new window.File([new Uint8Array([137, 80, 78, 71])], 'dot.png', { type: 'image/png' }),
  );
  const rows = () => $$('.composer .attachment');
  await waitFor(() => rows().length === 3, 'three attachments in the composer');
  assert.deepEqual(
    rows().map((row) => text(row.querySelector('.attachment-name'))),
    ['notes.txt', 'table.csv', 'dot.png'],
  );
  assert.equal(text(rows()[0].querySelector('.thumb')), '.txt');

  drop(new window.File(['%PDF'], 'paper.pdf', { type: 'application/pdf' }));
  const alert = () => $('.composer-error');
  await waitFor(alert, 'the rejected file message');
  assert.equal(alert().getAttribute('role'), 'alert');
  assert.match(text(alert()), /^The file was not attached: /);
  assert.equal(rows().length, 3);

  rows()[1].querySelector('[aria-label="Remove attachment"]').click();
  await waitFor(() => rows().length === 2, 'the attachment to go');
  await send('read this');
  assert.equal(rows().length, 0);
  assert.equal(alert(), null);
  const user = articles('user').at(-1);
  assert.deepEqual([...user.querySelectorAll('.attachment-name')].map(text), [
    'notes.txt',
    'dot.png',
  ]);
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
  assert.equal(lastText(), 'Echo: /error-stream now');
  assert.equal(
    text(lastAssistant().querySelector('[role="alert"]')),
    'The stream failed on purpose.',
  );
});

await check(
  'New chat opens an empty conversation, and the first one keeps its history',
  async () => {
    const history = messages();
    sidebar().querySelector('.new-thread').click();
    await waitFor(() => $('.welcome'), 'the new conversation');
    assert.deepEqual(threadTitles(), ['Hello there!']);
    assert.equal(activeTitle(), '');
    assert.equal(document.activeElement, input());

    openThread('Hello there!');
    await waitFor(() => activeTitle() === 'Hello there!', 'the first conversation');
    assert.deepEqual(messages(), history);
    assert.equal(document.activeElement, input());

    sidebar().querySelector('.new-thread').click();
    await waitFor(() => $('.welcome'), 'the new conversation again');
  },
);

await check('a tool the backend runs shows its call, then its result', async () => {
  const from = requests.length;
  type('weather in Rome');
  await waitFor(() => !sendButton().disabled, 'send to enable');
  sendButton().click();
  await waitFor(() => $('.tool-card[data-tool="get_weather"]'), 'the weather card');
  await idle();
  const card = $('.tool-card[data-tool="get_weather"]');
  assert.equal(text(card.querySelector('strong')), 'Rome');
  const forecast = text(card.querySelector('.tool-value'));
  const [, temperature, condition] = /^(\d+)°C, (\w+)$/.exec(forecast) ?? [];
  assert.ok(temperature && condition, forecast);
  assert.equal(lastText(), `It is ${temperature}°C and ${condition} in Rome.`);
  assert.equal(chatRequests(from).length, 1);
  await waitFor(() => threadTitles()[0] === 'weather in Rome', 'the generated title');
  assert.deepEqual(threadTitles(), ['weather in Rome', 'Hello there!']);
});

await check('a tool that needs approval waits for the user: Deny', async () => {
  const from = requests.length;
  await send('send an email to ada@example.com');
  const card = () => $$('.tool-card[data-tool="send_email"]').at(-1);
  assert.equal(card().dataset.answer, 'pending');
  assert.equal(
    text(card().querySelector('.tool-value')),
    'To ada@example.com: “Hello from ngx-assistant”',
  );
  assert.deepEqual([...card().querySelectorAll('button')].map(text), ['Approve', 'Deny']);
  assert.equal(isRunning(), false);
  assert.equal(chatRequests(from).length, 1);

  button(card(), 'Deny').click();
  await waitFor(() => lastText() === 'Understood, I did not send the email.', 'the reply to Deny');
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
  await send('send an email to bob@example.com');
  const card = () => $$('.tool-card[data-tool="send_email"]').at(-1);
  const approve = button(card(), 'Approve');
  approve.click();
  approve.click();
  await waitFor(() => lastText() === 'Done: the email to bob@example.com is sent.', 'the reply');
  await idle();
  assert.equal(card().dataset.answer, 'approved');
  assert.equal(text(card().querySelector('.tool-outcome')), 'Approved');
});

await check('a new message instead of an answer leaves the approval unanswered', async () => {
  await send('send an email to eve@example.com');
  const card = $$('.tool-card[data-tool="send_email"]').at(-1);
  assert.equal(card.dataset.answer, 'pending');
  await send('never mind');
  assert.equal(lastReply(), 'Echo: never mind');
  assert.equal(card.dataset.answer, 'unanswered');
  assert.equal(text(card.querySelector('.tool-outcome')), 'Not answered');
  assert.equal(card.querySelector('button'), null);
});

await check('the model picker sends the model and its effort with every run', async () => {
  await pickModel('Shout');
  assert.equal(text(modelTrigger()), 'Shout');
  await send('quiet please');
  assert.equal(lastReply(), 'ECHO: QUIET PLEASE');
  assert.equal(lastChatBody().modelName, 'shout');
  assert.equal(lastChatBody().reasoningEffort, undefined);

  await pickModel('Echo', 'High');
  assert.equal(text(modelTrigger()), 'Echo · high effort');
  await send('think first');
  assert.equal(text(lastAssistant().querySelector('.reasoning')), 'Thinking with high effort.');
  assert.equal(lastText(), 'Echo: think first');
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
  assert.deepEqual(
    requests.map((r) => `${r.method} ${r.path}`),
    ['GET /api/threads'],
  );

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
  assert.match(text($('.tool-card[data-tool="get_weather"] .tool-value')), /^\d+°C, \w+$/);
  assert.deepEqual(
    $$('.tool-card[data-tool="send_email"]').map((card) => card.dataset.answer),
    ['denied', 'approved', 'unanswered'],
  );
  assert.deepEqual(
    requests.map((r) => `${r.method} ${r.path}`),
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
  assert.equal(lastText(), 'Echo: /error-stream now');

  users[3].querySelector('[aria-label="Previous branch"]').click();
  await waitFor(() => branch(articles('user')[3]) === '1 / 2', 'the original message');
  assert.equal(messageText(articles('user')[3]), 'second message');
  // Off the head, a branch opens on whichever take the runtime picks: both are there.
  assert.match(branch(articles('assistant')[3]), /^[12] \/ 2$/);
});

await check('archiving, restoring and deleting conversations', async () => {
  const item = () => threadItems().find((i) => text(i).startsWith('Hello there!'));
  button(item(), 'Archive').click();
  await waitFor(() => archivedItems().length === 1, 'the archived conversation');
  assert.deepEqual(threadTitles(), ['weather in Rome']);
  // The archived conversation is no longer shown.
  assert.notEqual(activeTitle(), 'Hello there!');
  await waitFor(() => stored().threads['thread-1'].status === 'archived', 'the saved archive');

  button(archivedItems()[0], 'Restore').click();
  await waitFor(() => threadItems().length === 2, 'the restored conversation');
  assert.equal(archivedItems().length, 0);
  openThread('Hello there!');
  await waitFor(() => activeTitle() === 'Hello there!', 'the restored conversation shown');
  assert.equal(messageText(articles('user')[0]), 'Hello there!');
  await waitFor(() => stored().threads['thread-1'].status === 'regular', 'the saved restore');

  button(item(), 'Archive').click();
  await waitFor(() => archivedItems().length === 1, 'the archived conversation');
  button(archivedItems()[0], 'Delete').click();
  await waitFor(() => archivedItems().length === 0, 'the deleted conversation');
  assert.deepEqual(threadTitles(), ['weather in Rome']);
  await waitFor(() => !stored().threads['thread-1'], 'the conversation deleted on the backend');
  assert.equal(stored().messages['thread-1'], undefined);
  assert.deepEqual(errors, []);
});

console.log(`\n${checks.length} checks passed`);
window.close();
