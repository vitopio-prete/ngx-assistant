import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  NxaComposerAttachments,
  NxaComposerCancel,
  NxaComposerInput,
  NxaComposerRoot,
  NxaComposerSend,
} from '@ngx-assistant/angular';
import { NxaAttachment } from './attachment';

/**
 * The edit form of the nearest message: it takes the focus when it opens, Enter or Save sends the
 * new text as a new branch, and Escape or Cancel puts the message back (and the focus in the
 * thread composer, from the keyboard).
 */
@Component({
  selector: 'nxa-edit-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NxaComposerRoot,
    NxaComposerInput,
    NxaComposerCancel,
    NxaComposerSend,
    NxaComposerAttachments,
    NxaAttachment,
  ],
  host: { class: 'flex flex-col', 'data-slot': 'edit-composer' },
  template: `
    <form
      nxaComposerRoot
      class="ms-auto flex w-full max-w-[85%] flex-col rounded-2xl border border-nxa-border bg-nxa-muted/40 transition-colors focus-within:border-nxa-ring"
    >
      <div class="flex flex-wrap gap-2 px-3 pt-3 empty:hidden">
        <nxa-attachment *nxaComposerAttachments removable />
      </div>
      <textarea
        nxaComposerInput
        aria-label="Edit message"
        [autoFocus]="true"
        rows="2"
        class="min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
      ></textarea>
      <div class="mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
        <button
          nxaComposerCancel
          class="h-8 rounded-lg px-3 text-sm font-medium outline-none hover:bg-nxa-accent focus-visible:ring-2 focus-visible:ring-nxa-ring"
        >
          Cancel
        </button>
        <button
          nxaComposerSend
          class="h-8 rounded-lg bg-nxa-primary px-3 text-sm font-medium text-nxa-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </form>
  `,
})
export class NxaEditComposer {}
