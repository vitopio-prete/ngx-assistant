import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NxaErrorRoot, NxaMessageError } from '@ngx-assistant/angular';

/** The error text of a value the runtime reported: a string as is, anything else as JSON. */
export const errorText = (error: unknown): string => {
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
};

/** The error of the nearest message, announced when it appears; gone once the message runs again. */
@Component({
  selector: 'nxa-message-error',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaMessageError, NxaErrorRoot],
  host: { class: 'contents' },
  template: `
    <div
      *nxaMessageError="let error"
      nxaErrorRoot
      data-slot="message-error"
      class="mt-2 rounded-md border border-nxa-destructive/60 bg-nxa-destructive/10 p-3 text-sm text-nxa-destructive"
    >
      {{ text(error()) }}
    </div>
  `,
})
export class NxaMessageErrorNotice {
  protected readonly text = errorText;
}
