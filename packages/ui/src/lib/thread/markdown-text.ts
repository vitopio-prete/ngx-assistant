import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  linkedSignal,
} from '@angular/core';
import { injectSmoothText } from '@ngx-assistant/angular';
import MarkdownIt from 'markdown-it';

// Raw HTML in the text is shown as text, never rendered. Images are not loaded either: a reply
// could otherwise make the browser request any URL (and what the URL carries) without a click,
// so `![alt](url)` shows as a link.
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true }).disable('image');
const { escapeHtml, unescapeAll } = markdown.utils;
const rules = markdown.renderer.rules;
type Token = ReturnType<typeof markdown.parse>[number];
const COPY_LABEL = 'Copy code';
const COPIED_LABEL = 'Copied';

const renderToken = markdown.renderer.renderToken.bind(markdown.renderer);
rules['link_open'] = (tokens, index, options) => {
  const token = tokens[index]!;
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return renderToken(tokens, index, options);
};

// Tables scroll on their own inside a full-width wrapper.
rules['table_open'] = (tokens, index, options) =>
  `<div class="nxa-md-table">${renderToken(tokens, index, options)}`;
rules['table_close'] = (tokens, index, options) => `${renderToken(tokens, index, options)}</div>`;

// Column alignment comes as `style="text-align:…"`, which the sanitizer drops: use a class.
const alignCell: NonNullable<typeof rules.th_open> = (tokens, index, options) => {
  const token = tokens[index]!;
  const align = /text-align:(left|center|right)/.exec(String(token.attrGet('style') ?? ''))?.[1];
  if (align) {
    token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'style');
    token.attrJoin('class', `nxa-md-align-${align}`);
  }
  return renderToken(tokens, index, options);
};
rules['th_open'] = alignCell;
rules['td_open'] = alignCell;

/** The language of a fence: the first word of its info string, lowercase. */
const fenceLanguage = (info: string) => unescapeAll(info).trim().split(/\s+/)[0]!.toLowerCase();

/**
 * A code block with its header: the language and a Copy control. The sanitizer keeps no
 * `<button>` in rendered HTML, so the control is a focusable `role="button"` span that
 * {@link NxaMarkdownText} handles.
 */
const codeBlock = (language: string, code: string) =>
  `<div class="nxa-md-code">` +
  `<div class="nxa-md-code-header">` +
  `<span class="nxa-md-code-language">${escapeHtml(language)}</span>` +
  `<span class="nxa-md-code-copy" role="button" tabindex="0" aria-label="${COPY_LABEL}" title="${COPY_LABEL}"></span>` +
  `<span class="nxa-md-code-status" aria-live="polite"></span>` +
  `</div>` +
  `<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ''}>${escapeHtml(code)}</code></pre>` +
  `</div>\n`;
rules['fence'] = (tokens, index) => {
  const token = tokens[index]!;
  return codeBlock(fenceLanguage(token.info), token.content);
};
rules['code_block'] = (tokens, index) => codeBlock('', tokens[index]!.content);

/**
 * Renders a markdown string to HTML: raw HTML escaped, images as links, links in a new tab,
 * code blocks with a header, tables in a scrolling wrapper.
 */
export const renderMarkdown = (text: string): string => markdown.render(text);

/** A top-level block of a markdown text: its source lines and its HTML. */
export interface MarkdownBlock {
  readonly source: string;
  readonly html: string;
}

/** The tokens of each top-level block: from a level 0 token to the token that closes it. */
function splitTokens(tokens: Token[]): Token[][] {
  const blocks: Token[][] = [];
  for (let start = 0; start < tokens.length; start++) {
    const open = tokens[start]!;
    if (open.level !== 0) continue;
    let end = start;
    if (open.nesting === 1) {
      while (end < tokens.length - 1 && !(tokens[end]!.level === 0 && tokens[end]!.nesting === -1))
        end++;
    }
    blocks.push(tokens.slice(start, end + 1));
    start = end;
  }
  return blocks;
}

/**
 * Splits a markdown text into its top-level blocks (paragraphs, headings, lists, quotes, tables,
 * code) and renders each one. The whole text is parsed, so link reference definitions apply
 * everywhere. A block whose source and references match one of `previous` at the same index keeps
 * its HTML: while a reply streams, only the block that grows is rendered again.
 */
export function renderMarkdownBlocks(
  text: string,
  previous: readonly MarkdownBlock[] = [],
  previousReferences = '',
): { blocks: MarkdownBlock[]; references: string } {
  const env: Parameters<typeof markdown.parse>[1] = {};
  const tokens = markdown.parse(text, env);
  const references = JSON.stringify(env.references ?? {});
  const reuse = references === previousReferences;
  // markdown-it counts lines after turning every \r\n and lone \r into \n.
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const split = splitTokens(tokens);
  const blocks = split.map((block, index) => {
    const [from, to] = block[0]!.map ?? [0, lines.length];
    // The last block takes the rest of the text: a trailing newline changes an unclosed fence.
    const source = lines.slice(from, index === split.length - 1 ? undefined : to).join('\n');
    const before = previous[index];
    if (reuse && before?.source === source) return before;
    return { source, html: markdown.renderer.render(block, markdown.options, env) };
  });
  return { blocks, references };
}

/**
 * The text of the nearest `text` or `reasoning` part as markdown, revealed smoothly while it
 * streams. Each top-level block is its own element, so new text re-renders only the last block:
 * what is already written stays in place and can be selected while the reply streams. The HTML
 * goes through Angular's sanitizer; its typography, the code block headers and the pulsing dot
 * at the end of a running text are the `.nxa-md` styles of the theme.
 */
@Component({
  selector: 'nxa-markdown-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nxa-md block',
    '[attr.data-nxa-status]': 'text().status.type',
    '(click)': 'onClick($event)',
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    @for (block of blocks(); track $index) {
      <div class="nxa-md-block" [innerHTML]="block.html"></div>
    }
  `,
})
export class NxaMarkdownText {
  protected readonly text = injectSmoothText();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** The timer that turns each control back to Copy. */
  private readonly timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  private readonly rendered = linkedSignal<string, ReturnType<typeof renderMarkdownBlocks>>({
    source: () => this.text().text,
    computation: (text, previous) =>
      renderMarkdownBlocks(text, previous?.value.blocks, previous?.value.references),
  });
  protected readonly blocks = computed(() => this.rendered().blocks);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timers.forEach((timer) => clearTimeout(timer)));
  }

  protected onClick(event: MouseEvent) {
    const control = this.copyControl(event);
    if (control) this.copy(control);
  }

  protected onKeydown(event: KeyboardEvent) {
    if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat) return;
    const control = this.copyControl(event);
    if (!control) return;
    event.preventDefault();
    this.copy(control);
  }

  private copyControl(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) return null;
    const control = target.closest<HTMLElement>('.nxa-md-code-copy');
    return control && this.host.contains(control) ? control : null;
  }

  /** Copies the code of the block, then shows Copied for two seconds. */
  private copy(control: HTMLElement) {
    const code = control.closest('.nxa-md-code')?.querySelector('code')?.textContent ?? '';
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard) return;
    clipboard.writeText(code).then(
      () => {
        const status = control.parentElement?.querySelector('.nxa-md-code-status');
        clearTimeout(this.timers.get(control));
        control.classList.add('nxa-md-code-copied');
        control.setAttribute('aria-label', COPIED_LABEL);
        control.setAttribute('title', COPIED_LABEL);
        if (status) status.textContent = COPIED_LABEL;
        const timer = setTimeout(() => {
          this.timers.delete(control);
          control.classList.remove('nxa-md-code-copied');
          control.setAttribute('aria-label', COPY_LABEL);
          control.setAttribute('title', COPY_LABEL);
          if (status) status.textContent = '';
        }, 2000);
        this.timers.set(control, timer);
      },
      () => {
        // The browser refused the clipboard: nothing changes.
      },
    );
  }
}
