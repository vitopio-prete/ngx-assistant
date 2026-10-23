// End-to-end check of the production demo bundle in jsdom: send, streaming, keyboard and stop.
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

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole,
});
const { window } = dom;
const { document } = window;
window.addEventListener('error', (e) => errors.push(e.message));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const $ = (selector) => document.querySelector(selector);
const status = () => $('#status')?.textContent.trim();
const messages = () =>
  [...document.querySelectorAll('#messages li')].map((li) => ({
    role: li.dataset.role,
    text: [...li.querySelectorAll('span')].map((s) => s.textContent).join(''),
  }));
const lastAssistant = () => messages().findLast((m) => m.role === 'assistant')?.text ?? '';

async function waitFor(check, what, timeout = 5000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) assert.fail(`timed out waiting for ${what}`);
    await sleep(10);
  }
}

function type(text) {
  const input = $('#input');
  input.value = text;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function pressEnter(init = {}) {
  const event = new window.KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  $('#input').dispatchEvent(event);
  return event;
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

await check('the app mounts idle, with send disabled on an empty composer', async () => {
  await waitFor(() => $('#input') && status(), 'the app to mount');
  assert.equal(status(), 'idle');
  assert.equal($('#send').disabled, true);
  assert.equal($('#cancel').disabled, true);
  assert.deepEqual(messages(), []);
});

await check('the composer is bound to the runtime state', async () => {
  type('ciao mondo');
  await waitFor(() => !$('#send').disabled, 'send to enable');
  assert.equal($('#input').value, 'ciao mondo');
});

await check('Shift+Enter and Enter during IME composition do not send', async () => {
  const shift = pressEnter({ shiftKey: true });
  const ime = pressEnter({ isComposing: true });
  await sleep(50);
  assert.equal(shift.defaultPrevented, false);
  assert.equal(ime.defaultPrevented, false);
  assert.deepEqual(messages(), []);
  assert.equal($('#input').value, 'ciao mondo');
});

await check('Enter sends, clears the composer and streams the reply', async () => {
  const enter = pressEnter();
  assert.equal(enter.defaultPrevented, true);
  await waitFor(() => status() === 'running', 'the run to start');
  assert.equal($('#input').value, '');
  assert.deepEqual(messages()[0], { role: 'user', text: 'ciao mondo' });

  const frames = new Set();
  await waitFor(() => {
    frames.add(lastAssistant());
    return status() === 'idle';
  }, 'the run to finish');
  frames.delete('');
  assert.equal(lastAssistant(), 'Echo: ciao mondo');
  assert.ok(frames.size >= 2, `expected several streaming frames, saw ${[...frames].join(' | ')}`);
  assert.equal($('#cancel').disabled, true);
});

// Long enough (about 4 s of streaming) that Stop always lands before the reply is complete.
const longText = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');

await check(
  'the send button starts a run, and neither Enter nor send works during the run',
  async () => {
    type(longText);
    await waitFor(() => !$('#send').disabled, 'send to enable');
    $('#send').click();
    await waitFor(() => lastAssistant().startsWith('Echo: word0'), 'the second reply to stream');
    assert.equal(status(), 'running');
    assert.equal($('#cancel').disabled, false);
    assert.equal($('#send').disabled, true);

    type('second message');
    await sleep(20);
    assert.equal($('#send').disabled, true);
    const enter = pressEnter();
    assert.equal(enter.defaultPrevented, false);
    $('#send').click();
    await sleep(50);
    assert.equal(messages().filter((m) => m.role === 'user').length, 2);
    assert.equal($('#input').value, 'second message');
  },
);

await check('Stop cancels mid-stream and the reply stops growing', async () => {
  $('#cancel').click();
  await waitFor(() => status() === 'idle', 'the run to stop');
  const stopped = lastAssistant();
  assert.ok(
    stopped.length > 0 && `Echo: ${longText}`.startsWith(stopped),
    `unexpected reply: ${stopped}`,
  );
  assert.notEqual(stopped, `Echo: ${longText}`);
  await sleep(300);
  assert.equal(lastAssistant(), stopped);
  assert.equal($('#cancel').disabled, true);
});

await check('after Stop the thread accepts a new message, in order', async () => {
  const stopped = lastAssistant();
  await waitFor(() => !$('#send').disabled, 'send to enable after Stop');
  $('#send').click();
  await waitFor(() => lastAssistant() === 'Echo: second message', 'the third reply');
  await waitFor(() => status() === 'idle', 'the third run to finish');
  const all = messages();
  assert.deepEqual(
    all.map((m) => m.role),
    ['user', 'assistant', 'user', 'assistant', 'user', 'assistant'],
  );
  assert.equal(all[1].text, 'Echo: ciao mondo');
  assert.equal(all[3].text, stopped);
  assert.equal(all[4].text, 'second message');
});

await check('no errors were reported', async () => {
  assert.deepEqual(errors, []);
});

console.log(`\n${checks.length} checks passed`);
window.close();
