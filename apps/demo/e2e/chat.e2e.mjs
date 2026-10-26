// End-to-end check of the production demo bundle in jsdom: the thread, its branches, editing,
// regenerating, copying, attachments, errors, suggestions and the thread list.
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

const errors = [];
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
const { window } = dom;
const { document } = window;
window.addEventListener('error', (e) => errors.push(e.message));

// jsdom has no web streams, which the engine's stream helpers extend: lend it Node's.
for (const name of ['ReadableStream', 'WritableStream', 'TransformStream', 'TextDecoderStream']) {
  window[name] ??= globalThis[name];
}

// jsdom has no clipboard: record what the copy buttons write.
const clipboard = [];
Object.defineProperty(window.navigator, 'clipboard', {
  value: { writeText: async (text) => void clipboard.push(text) },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (element) => element?.textContent.replace(/\s+/g, ' ').trim() ?? '';

// The conversation shown; the others stay in the DOM, hidden.
const chat = () => document.querySelector('nxa-demo-chat:not([hidden])');
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
const branch = (article) => text(article.querySelector('.branch-label'));
const button = (article, label) =>
  [...article.querySelectorAll('button')].find((b) => text(b) === label);

const sidebar = () => document.querySelector('nxa-demo-thread-sidebar');
const threadItems = () => [...sidebar().querySelectorAll('.thread-list > .thread-item')];
const archivedItems = () => [...sidebar().querySelectorAll('.archived .thread-item')];
const threadTitles = () => threadItems().map((item) => text(item.querySelector('.thread-trigger')));
const activeTitle = () =>
  text(sidebar().querySelector('.thread-item[data-active] .thread-trigger'));

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

async function send(value) {
  type(value);
  await waitFor(() => sendButton() && !sendButton().disabled, 'send to enable');
  sendButton().click();
  await waitFor(isRunning, 'the run to start');
  await idle();
}

const checks = [];
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`ok - ${name}`);
}

const script = document.createElement('script');
script.textContent = fs.readFileSync(path.join(dist, main), 'utf8');
document.body.appendChild(script);

await check('the app mounts on one empty conversation, with suggestions', async () => {
  await waitFor(() => chat() && input(), 'the app to mount');
  assert.deepEqual(threadTitles(), ['New chat']);
  assert.equal(activeTitle(), 'New chat');
  assert.ok($('.welcome'));
  assert.deepEqual(
    $$('.suggestion').map((s) => text(s.querySelector('strong'))),
    ['Say hello', 'Show an error'],
  );
  assert.equal(sendButton().disabled, true);
  assert.equal(isRunning(), false);
  assert.deepEqual(messages(), []);
  assert.equal(document.activeElement, input());
});

await check('a suggestion sends its prompt and names the conversation', async () => {
  $$('.suggestion')[0].click();
  await waitFor(isRunning, 'the run to start');
  await idle();
  assert.deepEqual(messages(), [
    { role: 'user', text: 'Hello there!' },
    { role: 'assistant', text: 'Echo: Hello there!' },
  ]);
  assert.equal($('.welcome'), null);
  assert.deepEqual(threadTitles(), ['Hello there!']);
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

await check('Stop cancels mid-stream, and Enter does not send during the run', async () => {
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
  const stopped = lastReply();
  assert.ok(stopped.length > 0 && `Echo: ${longText}`.startsWith(stopped), stopped);
  assert.notEqual(stopped, `Echo: ${longText}`);
  await sleep(300);
  assert.equal(lastReply(), stopped);
});

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
  );
  const rows = () => $$('.composer .attachment');
  await waitFor(() => rows().length === 2, 'two attachments in the composer');
  assert.deepEqual(
    rows().map((row) => text(row.querySelector('.attachment-name'))),
    ['notes.txt', 'table.csv'],
  );
  assert.equal(text(rows()[0].querySelector('.thumb')), '.txt');

  drop(new window.File(['%PDF'], 'paper.pdf', { type: 'application/pdf' }));
  const alert = () => $('.composer-error');
  await waitFor(alert, 'the rejected file message');
  assert.equal(alert().getAttribute('role'), 'alert');
  assert.match(text(alert()), /^The file was not attached: /);
  assert.equal(rows().length, 2);

  rows()[1].querySelector('[aria-label="Remove attachment"]').click();
  await waitFor(() => rows().length === 1, 'the attachment to go');
  await send('read this');
  assert.equal(rows().length, 0);
  assert.equal(alert(), null);
  const user = articles('user').at(-1);
  assert.deepEqual([...user.querySelectorAll('.attachment-name')].map(text), ['notes.txt']);
  assert.equal(lastReply(), 'Echo: read this [attached: notes.txt]');
});

await check('a failed reply shows its error until it runs again', async () => {
  await send('/error now');
  const alert = () => lastAssistant().querySelector('[role="alert"]');
  assert.equal(text(alert()), 'The echo model failed on purpose.');
  button(lastAssistant(), 'Regenerate').click();
  await waitFor(isRunning, 'the regeneration to start');
  assert.equal(alert(), null);
  await idle();
  assert.equal(text(alert()), 'The echo model failed on purpose.');
});

await check(
  'New chat opens an empty conversation and the first one keeps its history',
  async () => {
    const history = messages();
    const first = chat();
    sidebar().querySelector('.new-thread').click();
    await waitFor(() => chat() !== first, 'the new conversation');
    assert.ok($('.welcome'));
    assert.deepEqual(threadTitles(), ['New chat', 'Hello there!']);
    assert.equal(activeTitle(), 'New chat');

    // A new chat that has not started yet is reused.
    sidebar().querySelector('.new-thread').click();
    await sleep(50);
    assert.equal(threadItems().length, 2);

    // ...even after switching away from it.
    threadItems()[1].querySelector('.thread-trigger').click();
    await waitFor(() => chat() === first, 'the first conversation');
    sidebar().querySelector('.new-thread').click();
    await waitFor(() => chat() !== first, 'the unstarted conversation');
    assert.equal(threadItems().length, 2);
    assert.equal(document.activeElement, input());

    await send('in the second chat');
    assert.deepEqual(threadTitles(), ['in the second chat', 'Hello there!']);

    threadItems()[1].querySelector('.thread-trigger').click();
    await waitFor(() => chat() === first, 'the first conversation');
    assert.equal(activeTitle(), 'Hello there!');
    assert.deepEqual(messages(), history);
  },
);

await check('archiving, restoring and deleting conversations', async () => {
  const item = () => threadItems().find((i) => text(i).startsWith('Hello there!'));
  button(item(), 'Archive').click();
  await waitFor(() => archivedItems().length === 1, 'the archived conversation');
  assert.deepEqual(threadTitles(), ['in the second chat']);
  assert.equal(activeTitle(), 'in the second chat');
  assert.equal(messageText(articles('user')[0]), 'in the second chat');

  button(archivedItems()[0], 'Restore').click();
  await waitFor(() => threadItems().length === 2, 'the restored conversation');
  assert.equal(archivedItems().length, 0);
  threadItems()
    .find((i) => text(i).startsWith('Hello there!'))
    .querySelector('.thread-trigger')
    .click();
  await waitFor(() => activeTitle() === 'Hello there!', 'the restored conversation shown');
  assert.equal(messageText(articles('user')[0]), 'Hello there!');

  button(item(), 'Archive').click();
  await waitFor(() => archivedItems().length === 1, 'the archived conversation');
  button(archivedItems()[0], 'Delete').click();
  await waitFor(() => archivedItems().length === 0, 'the deleted conversation');
  assert.deepEqual(threadTitles(), ['in the second chat']);
  assert.equal(document.querySelectorAll('nxa-demo-chat').length, 1);
});

await check('no errors were reported other than the failure asked for', async () => {
  // The runtime logs the regeneration that fails on purpose, above.
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], /Message reload failed.*The echo model failed on purpose\./);
});

console.log(`\n${checks.length} checks passed`);
window.close();
