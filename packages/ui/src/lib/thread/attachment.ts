import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  NxaAttachmentRemove,
  NxaAttachmentRoot,
  NxaAttachmentThumb,
  fromRuntime,
  injectAttachment,
} from '@ngx-assistant/angular';
import { NxaIcon } from '../icons';

/**
 * An attachment as a tile: a preview for an image, a short type label for any other file, its
 * name and, with `removable`, a button that removes it from the composer. A failed upload shows
 * its error; an upload in progress dims the tile.
 */
@Component({
  selector: 'nxa-attachment',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaAttachmentThumb, NxaAttachmentRemove, NxaIcon],
  hostDirectives: [NxaAttachmentRoot],
  host: {
    class:
      'relative flex max-w-56 items-center gap-2 rounded-lg border border-nxa-border bg-nxa-muted p-1.5 pe-2 text-xs data-[nxa-attachment-status=incomplete]:border-nxa-destructive data-[nxa-attachment-status=running]:opacity-70',
    '[attr.title]': 'error() ?? state().name',
  },
  template: `
    @if (preview(); as src) {
      <img [src]="src" alt="" class="size-9 shrink-0 rounded-md object-cover" />
    } @else {
      <span
        nxaAttachmentThumb
        #thumb="nxaAttachmentThumb"
        class="flex size-9 shrink-0 items-center justify-center rounded-md bg-nxa-background font-mono text-[10px] text-nxa-muted-foreground uppercase"
        >{{ thumb.label() }}</span
      >
    }
    <span class="flex min-w-0 flex-col">
      <span class="truncate font-medium">{{ state().name }}</span>
      @if (error(); as message) {
        <span class="truncate text-nxa-destructive">{{ message }}</span>
      } @else if (uploading()) {
        <span class="text-nxa-muted-foreground" role="status">Uploading…</span>
      }
    </span>
    @if (removable()) {
      <button
        nxaAttachmentRemove
        class="absolute -end-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-nxa-border bg-nxa-background text-nxa-muted-foreground outline-none hover:text-nxa-foreground focus-visible:ring-2 focus-visible:ring-nxa-ring"
        [attr.aria-label]="'Remove ' + state().name"
      >
        <nxa-icon name="x" class="size-3" />
      </button>
    }
  `,
})
export class NxaAttachment {
  readonly removable = input(false, { transform: booleanAttribute });

  protected readonly state = fromRuntime(injectAttachment(), (s) => s);
  protected readonly uploading = computed(() => this.state().status.type === 'running');
  protected readonly error = computed(() => {
    const status = this.state().status;
    return status.type === 'incomplete' ? (status.message ?? 'The upload failed') : null;
  });

  private readonly objectUrl = signal<string | null>(null);
  protected readonly preview = computed(() => {
    const state = this.state();
    if (state.type !== 'image') return null;
    const image = state.content?.find((part) => part.type === 'image');
    return image?.type === 'image' ? image.image : this.objectUrl();
  });

  constructor() {
    // A pending image has no content yet: preview its file, and free the URL afterwards.
    const file = computed(() => {
      const state = this.state();
      return state.type === 'image' && !state.content?.length ? (state.file ?? null) : null;
    });
    let url: string | null = null;
    const revoke = () => {
      if (url) URL.revokeObjectURL?.(url);
      url = null;
    };
    effect(() => {
      revoke();
      const current = file();
      url =
        current && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(current) : null;
      this.objectUrl.set(url);
    });
    inject(DestroyRef).onDestroy(revoke);
  }
}
