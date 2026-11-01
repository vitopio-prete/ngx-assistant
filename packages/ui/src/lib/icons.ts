import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** The icons the components use: 24×24 strokes in the current text color. */
const ICONS = {
  archive: 'M4 5h16v4H4z M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9 M10 13h4',
  'archive-restore':
    'M4 5h16v4H4z M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9 M12 18v-6 M9.5 14.5L12 12l2.5 2.5',
  'arrow-down': 'M12 5v14 M19 12l-7 7-7-7',
  'arrow-up': 'M12 19V5 M5 12l7-7 7 7',
  bot: 'M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z M12 8V4 M9 13v2 M15 13v2',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'circle-alert': 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M12 8v5 M12 16.5v.01',
  'circle-minus': 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M8 12h8',
  'circle-x': 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z M9 9l6 6 M15 9l-6 6',
  copy: 'M10 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z M5 15V5a1 1 0 0 1 1-1h10',
  download: 'M12 4v11 M7 10.5l5 5 5-5 M5 20h14',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5',
  history: 'M4 12a8 8 0 1 0 2.3-5.7 M4 4v4h4 M12 8v4l3 2',
  loader: 'M12 3a9 9 0 1 0 9 9',
  more: 'M5.5 12h.01 M12 12h.01 M18.5 12h.01',
  paperclip:
    'M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.2-8.2a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.5-7.5',
  pencil: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
  plus: 'M12 5v14 M5 12h14',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z M20 20l-4-4',
  sparkle:
    'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  stop: 'M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
  'thumbs-down':
    'M17 4v9 M17 13l-4 7a2.2 2.2 0 0 1-2.1-2.6l.6-3.4H6a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 7.2 4H17h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-2',
  'thumbs-up':
    'M7 20v-9 M7 11l4-7a2.2 2.2 0 0 1 2.1 2.6l-.6 3.4H18a2 2 0 0 1 2 2.3l-1.2 6a2 2 0 0 1-2 1.7H7H5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h2',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v5 M14 11v5',
  volume: 'M4 9.5h3.5L12 5v14l-4.5-4.5H4z M16 9a4 4 0 0 1 0 6 M18.5 6.5a7.5 7.5 0 0 1 0 11',
  x: 'M6 6l12 12 M18 6L6 18',
} as const;

/** The name of an icon of {@link NxaIcon}. */
export type NxaIconName = keyof typeof ICONS;

/**
 * An inline SVG icon, hidden from assistive technology: the control around it carries the label.
 * Its size follows the host's (`class="size-4"`).
 */
@Component({
  selector: 'nxa-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  template: `
    <svg
      class="size-full"
      viewBox="0 0 24 24"
      [attr.fill]="filled() ? 'currentColor' : 'none'"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path [attr.d]="path()" />
    </svg>
  `,
})
export class NxaIcon {
  readonly name = input.required<NxaIconName>();
  /** Fills the shape instead of stroking it only, as for the stop square. */
  readonly filled = input(false);

  protected readonly path = computed(() => ICONS[this.name()]);
}
