import type { ThreadMessageLike } from '@ngx-assistant/engine';
import axe from 'axe-core';
import { mountThread, settle, stubResizeObserver } from '../../testing/thread-harness';
import { renderMarkdown, renderMarkdownBlocks } from './markdown-text';

const reply = (text: string, running = false): ThreadMessageLike => ({
  role: 'assistant',
  content: [{ type: 'text', text }],
  ...(running ? { status: { type: 'running' } } : {}),
});

const blocksOf = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('.nxa-md-block')];

beforeAll(stubResizeObserver);

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('renderMarkdownBlocks', () => {
  const html = (text: string) => renderMarkdownBlocks(text).blocks.map((block) => block.html);

  it('renders each top-level block on its own', () => {
    const blocks = html(
      '# Title\n\nSome *text*.\n\n- one\n- two\n\n> quote\n\n---\n\n```ts\nx\n```',
    );
    expect(blocks).toHaveLength(6);
    expect(blocks[0]).toMatch(/^<h1>Title<\/h1>/);
    expect(blocks[1]).toMatch(/^<p>Some <em>text<\/em>.<\/p>/);
    expect(blocks[2]).toMatch(/^<ul>[\s\S]*<li>two<\/li>[\s\S]*<\/ul>/);
    expect(blocks[3]).toMatch(/^<blockquote>/);
    expect(blocks[4]).toMatch(/^<hr>/);
    expect(blocks[5]).toContain('class="nxa-md-code"');
  });

  it('matches the HTML of the whole text rendered at once', () => {
    const text =
      '## A\n\n1. first\n   ```sh\n   pnpm i\n   ```\n2. second\n\n| a | b |\n|:-:|--:|\n| 1 | 2 |\n\nend [ref]\n\n[ref]: https://angular.dev';
    expect(html(text).join('')).toBe(renderMarkdown(text));
  });

  it('keeps an unclosed fence as code while it streams', () => {
    const blocks = html('Look:\n\n```ts\nconst a = 1;\nconst b');
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toContain('<code class="language-ts">const a = 1;\nconst b');
  });

  it('turns the last paragraph into a heading when a setext underline arrives', () => {
    expect(html('Intro\n\nTitle')[1]).toMatch(/^<p>Title/);
    expect(html('Intro\n\nTitle\n---')[1]).toMatch(/^<h2>Title<\/h2>/);
  });

  it('reuses the blocks that did not change and renders the one that grows', () => {
    const first = renderMarkdownBlocks('Hello\n\nWor');
    const next = renderMarkdownBlocks('Hello\n\nWorld', first.blocks, first.references);
    expect(next.blocks[0]).toBe(first.blocks[0]);
    expect(next.blocks[1]).not.toBe(first.blocks[1]);
    expect(next.blocks[1]!.html).toContain('World');
  });

  it('renders every block again when a link reference arrives later', () => {
    const first = renderMarkdownBlocks('see [docs]\n\nmore');
    expect(first.blocks[0]!.html).not.toContain('<a');
    const next = renderMarkdownBlocks(
      'see [docs]\n\nmore\n\n[docs]: https://angular.dev',
      first.blocks,
      first.references,
    );
    expect(next.blocks[0]).not.toBe(first.blocks[0]);
    expect(next.blocks[0]!.html).toContain('href="https://angular.dev"');
  });

  it('follows a text that gets shorter or changes entirely', () => {
    const first = renderMarkdownBlocks('a\n\nb\n\nc');
    expect(renderMarkdownBlocks('a', first.blocks, first.references).blocks).toHaveLength(1);
    const other = renderMarkdownBlocks('x\n\nb', first.blocks, first.references).blocks;
    expect(other[0]!.html).toContain('x');
    expect(other[1]).toBe(first.blocks[1]);
  });

  it('counts lines as the parser does when the text has carriage returns', () => {
    const first = renderMarkdownBlocks('x\r\ry');
    const next = renderMarkdownBlocks('x\r\rz', first.blocks, first.references);
    expect(next.blocks.map((block) => block.html).join('')).toBe(renderMarkdown('x\r\rz'));
    expect(renderMarkdownBlocks('a\r\n\r\nb').blocks).toHaveLength(2);
  });

  it('renders an unclosed fence again when a newline arrives at its end', () => {
    const first = renderMarkdownBlocks('```\nab');
    const next = renderMarkdownBlocks('```\nab\n', first.blocks, first.references);
    expect(next.blocks[0]!.html).toBe(renderMarkdown('```\nab\n'));
  });

  it('renders the blocks again when a link reference goes away', () => {
    const first = renderMarkdownBlocks('see [docs]\n\n[docs]: https://angular.dev');
    const next = renderMarkdownBlocks('see [docs]', first.blocks, first.references);
    expect(next.blocks[0]!.html).not.toContain('<a');
  });

  it('escapes what a fence info string carries into the header and the class', () => {
    const [block] = html('```"><img src=x onerror=alert(1)>\nx\n```');
    expect(block).not.toContain('<img');
    expect(block).toContain('&quot;&gt;&lt;img');
    const [tilde] = html("~~~py'x\nprint()\n~~~");
    expect(tilde).toContain('<span class="nxa-md-code-language">py\'x</span>');
  });

  it('has no blocks for an empty text', () => {
    expect(renderMarkdownBlocks('').blocks).toEqual([]);
    expect(renderMarkdownBlocks('\n\n').blocks).toEqual([]);
  });

  it('writes the language and a copy control in the header of a code block', () => {
    const [block] = html('```TypeScript title="a.ts"\nlet a = "<b>";\n```');
    expect(block).toContain('<span class="nxa-md-code-language">typescript</span>');
    expect(block).toContain('role="button" tabindex="0" aria-label="Copy code"');
    expect(block).toContain('<code class="language-typescript">let a = &quot;&lt;b&gt;&quot;;');
    const [indented] = html('    plain code');
    expect(indented).toContain('<span class="nxa-md-code-language"></span>');
    expect(indented).toContain('<pre><code>plain code');
  });

  it('wraps tables and turns column alignment into classes', () => {
    const [table] = html('| a | b | c |\n|:-:|--:|---|\n| 1 | 2 | 3 |');
    expect(table).toMatch(/^<div class="nxa-md-table"><table>[\s\S]*<\/table>\n?<\/div>/);
    expect(table).toContain('<th class="nxa-md-align-center">a</th>');
    expect(table).toContain('<td class="nxa-md-align-right">2</td>');
    expect(table).not.toContain('style=');
  });
});

describe('nxa-markdown-text', () => {
  it('keeps the blocks already written in place while the reply streams', async () => {
    const { el, fixture, update } = await mountThread([reply('First paragraph.\n\nSec', true)], {
      isRunning: true,
    });
    await settle(fixture, () => expect(blocksOf(el)).toHaveLength(2));
    const [first] = blocksOf(el);
    const paragraph = first!.firstElementChild!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    update([reply('First paragraph.\n\nSecond paragraph.\n\n- item', true)], { isRunning: true });
    await settle(fixture, () => expect(blocksOf(el)).toHaveLength(3));
    expect(blocksOf(el)[0]!.firstElementChild).toBe(paragraph);
    expect(paragraph.isConnected).toBe(true);
    // The selection still spans the same nodes: nothing re-rendered under it.
    expect(range.collapsed).toBe(false);
    expect(range.toString()).toBe('First paragraph.');
    expect(blocksOf(el)[1]!.textContent?.trim()).toBe('Second paragraph.');
  });

  it('marks the text running while it streams and complete at the end', async () => {
    const { el, fixture, update } = await mountThread([reply('Hel', true)], { isRunning: true });
    await settle(fixture, () =>
      expect(el.querySelector('.nxa-md')?.getAttribute('data-nxa-status')).toBe('running'),
    );

    update([reply('Hello')]);
    await settle(fixture, () =>
      expect(el.querySelector('.nxa-md')?.getAttribute('data-nxa-status')).toBe('complete'),
    );
    expect(el.querySelector('.nxa-md')!.textContent?.trim()).toBe('Hello');
  });

  it('stops the running mark when the reply is cancelled', async () => {
    const { el, fixture, update } = await mountThread([reply('Hel', true)], { isRunning: true });
    await settle(fixture, () =>
      expect(el.querySelector('.nxa-md')?.getAttribute('data-nxa-status')).toBe('running'),
    );
    update([
      { ...reply('Hel'), status: { type: 'incomplete', reason: 'cancelled' } } as ThreadMessageLike,
    ]);
    await settle(fixture, () =>
      expect(el.querySelector('.nxa-md')?.getAttribute('data-nxa-status')).toBe('incomplete'),
    );
  });

  it('follows a reply replaced by a different text', async () => {
    const { el, fixture, update } = await mountThread([reply('One\n\nTwo\n\nThree')]);
    await settle(fixture, () => expect(blocksOf(el)).toHaveLength(3));
    update([reply('Other')]);
    await settle(fixture, () => expect(blocksOf(el)).toHaveLength(1));
    expect(blocksOf(el)[0]!.textContent?.trim()).toBe('Other');
  });

  const copyControl = (root: ParentNode) => root.querySelector<HTMLElement>('.nxa-md-code-copy')!;

  const mountCode = async (text = 'Run:\n\n```sh\necho "<hi>" && ls\n```') => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const mounted = await mountThread([reply(text)]);
    await settle(mounted.fixture, () => expect(copyControl(mounted.el)).not.toBeNull());
    return { ...mounted, writeText };
  };

  it('copies the code of a block with a click, then shows Copied for a while', async () => {
    const { el, fixture, writeText } = await mountCode();
    const control = copyControl(el);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    control.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('echo "<hi>" && ls\n'));
    await vi.waitFor(() => expect(control.getAttribute('aria-label')).toBe('Copied'));
    expect(control.classList).toContain('nxa-md-code-copied');

    vi.advanceTimersByTime(2000);
    expect(control.getAttribute('aria-label')).toBe('Copy code');
    expect(control.classList).not.toContain('nxa-md-code-copied');
    vi.useRealTimers();
    await fixture.whenStable();
  });

  it('announces Copied and keeps it two seconds after the last copy', async () => {
    const { el, fixture, writeText } = await mountCode();
    const control = copyControl(el);
    const status = el.querySelector('.nxa-md-code-status')!;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(control.getAttribute('aria-label')).toBe('Copy code');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    control.click();
    await vi.waitFor(() => expect(status.textContent).toBe('Copied'));
    vi.advanceTimersByTime(1500);
    control.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
    expect(control.getAttribute('aria-label')).toBe('Copied');
    vi.advanceTimersByTime(1000);
    expect(control.getAttribute('aria-label')).toBe('Copy code');
    expect(status.textContent).toBe('');
    vi.useRealTimers();
    await fixture.whenStable();
  });

  it('changes nothing when the browser refuses the clipboard', async () => {
    const { el, writeText } = await mountCode();
    writeText.mockRejectedValue(new Error('denied'));
    const control = copyControl(el);
    control.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    await Promise.resolve();
    expect(control.getAttribute('aria-label')).toBe('Copy code');
  });

  it('does not copy again while a key is held down', async () => {
    const { el, writeText } = await mountCode();
    copyControl(el).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }),
    );
    await Promise.resolve();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies from the keyboard with Enter and Space, and ignores other keys', async () => {
    const { el, writeText } = await mountCode();
    const control = copyControl(el);
    const press = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      control.dispatchEvent(event);
      return event;
    };

    expect(press('a').defaultPrevented).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
    expect(press('Enter').defaultPrevented).toBe(true);
    expect(press(' ').defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
  });

  it('copies a code block nested in a list item', async () => {
    const { el, writeText } = await mountCode('1. Install:\n   ```bash\n   pnpm add x\n   ```');
    expect(el.querySelector('li .nxa-md-code-language')?.textContent).toBe('bash');
    copyControl(el).click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('pnpm add x\n'));
  });

  it('keeps the header and the control through the sanitizer', async () => {
    const { el } = await mountCode();
    const control = copyControl(el);
    expect(control.getAttribute('role')).toBe('button');
    expect(control.getAttribute('tabindex')).toBe('0');
    expect(el.querySelector('.nxa-md-code-language')?.textContent).toBe('sh');
    expect(el.querySelector('.nxa-md-code pre code')?.className).toBe('language-sh');
  });

  it('has no accessibility violations with code and a table', async () => {
    const { el } = await mountCode(
      '## Result\n\n```ts\nconst a = 1;\n```\n\n| a | b |\n|:-:|--:|\n| 1 | 2 |',
    );
    const results = await axe.run(el.querySelector('.nxa-md')!, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
