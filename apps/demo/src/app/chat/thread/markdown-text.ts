import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { injectSmoothText } from '@ngx-assistant/angular';
import MarkdownIt from 'markdown-it';

// Raw HTML in the text is shown as text, never rendered. Images are not loaded either: a reply
// could otherwise make the browser request any URL (and what the URL carries) without a click,
// so `![alt](url)` shows as a link.
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true }).disable('image');

const renderToken = markdown.renderer.renderToken.bind(markdown.renderer);
markdown.renderer.rules['link_open'] = (tokens, index, options) => {
  const token = tokens[index]!;
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return renderToken(tokens, index, options);
};

/**
 * Renders a markdown string to HTML: raw HTML escaped, images as links, links in a new tab.
 */
export const renderMarkdown = (text: string): string => markdown.render(text);

/**
 * The text of the nearest `text` or `reasoning` part as markdown, revealed smoothly while it
 * streams. The HTML goes through Angular's sanitizer; its typography is the `.nxa-md` class of
 * the theme.
 */
@Component({
  selector: 'nxa-markdown-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'nxa-md block',
    '[innerHTML]': 'html()',
    '[attr.data-nxa-status]': 'text().status.type',
  },
  template: '',
})
export class NxaMarkdownText {
  protected readonly text = injectSmoothText();
  protected readonly html = computed(() => renderMarkdown(this.text().text));
}
