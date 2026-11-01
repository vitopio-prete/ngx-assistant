import { ChangeDetectionStrategy, Component, effect, signal } from '@angular/core';
import { provideLocalRuntime, provideSuggestions } from '@ngx-assistant/angular';
import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
} from '@ngx-assistant/engine';
import { NxaThread } from '../lib';
import { previewModel } from './preview-model';

/** A page to try the styled components by hand, in light and dark. */
@Component({
  selector: 'nxa-preview-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaThread],
  host: { class: 'flex h-full flex-col' },
  providers: [
    provideLocalRuntime(previewModel, {
      adapters: {
        attachments: new CompositeAttachmentAdapter([
          new SimpleImageAttachmentAdapter(),
          new SimpleTextAttachmentAdapter(),
        ]),
      },
    }),
    provideSuggestions([
      {
        title: 'Show markdown',
        label: 'headings, lists, code, a table',
        prompt: 'Show me markdown',
      },
      { title: 'Think first', label: 'a reasoning part', prompt: '/reasoning' },
      { title: 'Call a tool', label: 'the tool fallback', prompt: '/tool' },
      { title: 'Ask for approval', label: 'options with a confirmation', prompt: '/approval' },
    ]),
  ],
  template: `
    <header class="flex items-center justify-between border-b border-nxa-border px-4 py-2">
      <span class="text-sm font-semibold">ngx-assistant UI preview</span>
      <button
        type="button"
        class="rounded-md border border-nxa-border px-2.5 py-1 text-sm hover:bg-nxa-accent"
        [attr.aria-pressed]="dark()"
        (click)="dark.set(!dark())"
      >
        {{ dark() ? 'Light' : 'Dark' }} theme
      </button>
    </header>
    <nxa-thread class="min-h-0 flex-1" />
  `,
})
export class PreviewApp {
  protected readonly dark = signal(matchMedia('(prefers-color-scheme: dark)').matches);

  constructor() {
    effect(() => {
      const root = document.documentElement;
      root.classList.toggle('dark', this.dark());
      root.classList.toggle('light', !this.dark());
    });
  }
}
