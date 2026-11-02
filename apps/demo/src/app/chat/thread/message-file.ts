import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { MessagePartState } from '@ngx-assistant/engine';
import { NxaIcon } from '../icons';

type FileLikePart = Extract<MessagePartState, { type: 'image' } | { type: 'file' }>;

const TYPE_NAMES: Record<string, string> = {
  'application/pdf': 'PDF document',
  'application/json': 'JSON file',
  'text/plain': 'Text file',
  'text/markdown': 'Markdown file',
  'text/csv': 'CSV file',
};

/** A readable name for a file without one, from its media type. */
export const describeMediaType = (mimeType: string): string =>
  TYPE_NAMES[mimeType] ??
  (mimeType.startsWith('image/')
    ? 'Image'
    : mimeType.startsWith('text/')
      ? 'Text file'
      : mimeType.startsWith('audio/')
        ? 'Audio file'
        : mimeType.startsWith('video/')
          ? 'Video file'
          : 'File');

const toUrl = (data: string, mimeType: string) =>
  /^(data:|blob:|https?:)/.test(data) ? data : `data:${mimeType};base64,${data}`;

/**
 * An `image` or `file` part of a message: a preview for an image, an icon and a name for any
 * other file.
 */
@Component({
  selector: 'nxa-message-file',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaIcon],
  host: { class: 'block', 'data-slot': 'message-file' },
  template: `
    @if (preview(); as src) {
      <span
        data-slot="image-preview"
        class="block overflow-hidden rounded-lg border border-nxa-border"
      >
        <img [src]="src" [alt]="name() ?? 'Image'" class="max-h-64 max-w-full object-contain" />
      </span>
    } @else {
      <span
        class="inline-flex items-center gap-2 rounded-lg border border-nxa-border bg-nxa-muted px-3 py-2 text-sm"
      >
        <nxa-icon name="file" class="size-4 text-nxa-muted-foreground" />
        <span data-slot="file-name" class="max-w-60 truncate">{{ name() ?? typeName() }}</span>
      </span>
    }
  `,
})
export class NxaMessageFile {
  readonly part = input.required<FileLikePart>();

  protected readonly mimeType = computed(() => {
    const part = this.part();
    return part.type === 'file' ? part.mimeType : 'image/*';
  });
  protected readonly name = computed(() => this.part().filename);
  protected readonly typeName = computed(() => describeMediaType(this.mimeType()));
  protected readonly preview = computed(() => {
    const part = this.part();
    if (part.type === 'image') return part.image;
    return part.mimeType.startsWith('image/') ? toUrl(part.data, part.mimeType) : null;
  });
}
