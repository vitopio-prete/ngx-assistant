import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The greeting of an empty thread. It slides in when the thread is shown. `align` puts it at the
 * start, above a centered composer, or in the middle. Content inside it goes under the greeting,
 * such as `<nxa-thread-suggestions variant="grid" />`.
 */
@Component({
  selector: 'nxa-thread-welcome',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-slot': 'thread-welcome',
    '[attr.data-align]': 'align()',
    '[class]':
      'align() === "start" ? "flex flex-col gap-6 px-2 pb-6" : "flex flex-1 flex-col items-center justify-center gap-6 py-12"',
  },
  template: `
    <h2
      class="nxa-animate-in nxa-slide-in-1 nxa-duration-200 text-2xl"
      [class]="align() === 'start' ? 'font-medium tracking-tight' : 'text-center font-semibold'"
    >
      {{ title() }}
    </h2>
    <ng-content />
  `,
})
export class NxaThreadWelcome {
  readonly title = input('How can I help you today?');
  /** `start` above a centered composer, `center` in the middle of the thread. */
  readonly align = input<'start' | 'center'>('center');
}
