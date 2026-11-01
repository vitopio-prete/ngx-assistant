import { ChangeDetectionStrategy, Component, effect, signal } from '@angular/core';
import {
  provideLocalRuntime,
  provideRemoteThreadListRuntime,
  provideSuggestions,
  provideToolUi,
  type ModelOption,
} from '@ngx-assistant/angular';
import {
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  WebSpeechSynthesisAdapter,
} from '@ngx-assistant/engine';
import { NxaAssistantModal, NxaModelSelector, NxaThread, NxaThreadList } from '../lib';
import { PreviewPublishUi } from './preview-approval';
import { previewModel } from './preview-model';
import { previewThreads } from './preview-threads';

const MODELS: ModelOption[] = [
  { id: 'swift', name: 'Swift', description: 'Quick answers' },
  { id: 'balanced', name: 'Balanced', description: 'Everyday work', efforts: true },
  { id: 'deep', name: 'Deep', description: 'Long reasoning', efforts: true },
];

/** A page to try the styled components by hand, in light and dark. */
@Component({
  selector: 'nxa-preview-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaThread, NxaThreadList, NxaAssistantModal, NxaModelSelector],
  host: { class: 'flex h-full flex-col' },
  providers: [
    provideRemoteThreadListRuntime({
      adapter: previewThreads(),
      runtime: () =>
        provideLocalRuntime(previewModel, {
          adapters: {
            attachments: new CompositeAttachmentAdapter([
              new SimpleImageAttachmentAdapter(),
              new SimpleTextAttachmentAdapter(),
            ]),
            feedback: { submit: () => undefined },
            ...(typeof speechSynthesis === 'undefined'
              ? {}
              : { speech: new WebSpeechSynthesisAdapter() }),
          },
        }),
    }),
    provideToolUi({ toolName: 'publish_release', component: PreviewPublishUi }),
    provideSuggestions([
      {
        title: 'Show markdown',
        label: 'headings, lists, code, a table',
        prompt: 'Show me markdown',
      },
      { title: 'Think first', label: 'a reasoning part', prompt: '/reasoning' },
      { title: 'Call a tool', label: 'the tool fallback', prompt: '/tool' },
      { title: 'Ask for approval', label: 'an approval card', prompt: '/approval-card' },
    ]),
  ],
  template: `
    <header class="flex items-center gap-3 border-b border-nxa-border px-4 py-2">
      <span class="text-sm font-semibold">ngx-assistant UI preview</span>
      <nxa-model-selector [models]="models" />
      <nav class="ms-auto flex items-center gap-1" aria-label="Layout">
        @for (option of layouts; track option) {
          <button
            type="button"
            class="rounded-md px-2.5 py-1 text-sm capitalize hover:bg-nxa-accent aria-pressed:bg-nxa-muted"
            [attr.aria-pressed]="layout() === option"
            (click)="layout.set(option)"
          >
            {{ option }}
          </button>
        }
      </nav>
      <button
        type="button"
        class="rounded-md border border-nxa-border px-2.5 py-1 text-sm hover:bg-nxa-accent"
        [attr.aria-pressed]="dark()"
        (click)="dark.set(!dark())"
      >
        {{ dark() ? 'Light' : 'Dark' }} theme
      </button>
    </header>
    @if (layout() === 'sidebar') {
      <div class="flex min-h-0 flex-1">
        <aside class="w-64 shrink-0 overflow-y-auto border-e border-nxa-border p-2">
          <nxa-thread-list />
        </aside>
        <nxa-thread class="min-h-0 flex-1" />
      </div>
    } @else {
      <main
        class="mx-auto flex max-w-2xl flex-1 flex-col gap-4 p-8 text-sm text-nxa-muted-foreground"
      >
        <h1 class="text-2xl font-semibold text-nxa-foreground">A page with a chat widget</h1>
        <p>
          The button in the corner opens the assistant modal: the thread, the Threads view to pick
          or start a thread, and the resize handle in its top corner.
        </p>
      </main>
      <nxa-assistant-modal />
    }
  `,
})
export class PreviewApp {
  protected readonly models = MODELS;
  protected readonly layouts = ['sidebar', 'modal'] as const;
  protected readonly layout = signal<'sidebar' | 'modal'>('sidebar');
  protected readonly dark = signal(matchMedia('(prefers-color-scheme: dark)').matches);

  constructor() {
    effect(() => {
      const root = document.documentElement;
      root.classList.toggle('dark', this.dark());
      root.classList.toggle('light', !this.dark());
    });
  }
}
