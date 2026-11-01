import { DOCUMENT, Directive, booleanAttribute, computed, inject, input } from '@angular/core';
import { injectMessage } from '../scopes';
import { copyDisabled } from './action-state';

/** Receives the markdown of a message instead of the default download. */
export type NxaExportMarkdown = (content: string) => void | Promise<void>;

const reportFailure = (error: unknown) => {
  console.error('[ngx-assistant] Exporting the message as markdown failed', error);
};

/** How long the object URL of a download stays valid, in milliseconds. */
const REVOKE_DELAY = 40_000;

/**
 * A button that exports the text of the nearest message as a markdown file. By default it
 * downloads `filename` (`message-<timestamp>.md` when not set); with `exportMarkdown` it hands the
 * text to that function instead. Disabled while an assistant message is still running or the
 * message has no text. A failed export is reported with `console.error`. A capture-phase `click`
 * listener can veto it with `preventDefault()`.
 *
 * @example
 * ```html
 * <button nxaActionBarExportMarkdown filename="answer.md">Export</button>
 * ```
 */
@Directive({
  selector: 'button[nxaActionBarExportMarkdown]',
  host: { type: 'button', '[disabled]': 'isDisabled()', '(click)': 'onClick($event)' },
})
export class NxaActionBarExportMarkdown {
  /** The name of the downloaded file. */
  readonly filename = input<string | null | undefined>(undefined);
  /** Receives the text instead of the download. */
  readonly exportMarkdown = input<NxaExportMarkdown | null | undefined>(undefined);
  /** Disables the button on top of the message state. */
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly document = inject(DOCUMENT);
  private readonly message = injectMessage();
  private readonly nothingToExport = copyDisabled(this.message);
  protected readonly isDisabled = computed(() => this.disabled() || this.nothingToExport());

  protected onClick(event: MouseEvent) {
    if (event.defaultPrevented || this.isDisabled()) return;
    const content = this.message.unstable_getCopyText();
    if (!content) return;
    const exportMarkdown = this.exportMarkdown();
    // Both run inside the click, so APIs that need a user gesture accept them.
    try {
      if (exportMarkdown) Promise.resolve(exportMarkdown(content)).catch(reportFailure);
      else this.download(content);
    } catch (error) {
      reportFailure(error);
    }
  }

  private download(content: string) {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = this.document.createElement('a');
    anchor.href = url;
    anchor.download = this.filename() || `message-${Date.now()}.md`;
    anchor.rel = 'noopener';
    // Firefox starts a download only for an anchor that is in the document.
    this.document.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY);
    }
  }
}
