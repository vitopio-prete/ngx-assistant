/** The classes of the icon buttons of the action bars. */
export const ACTION_BUTTON =
  'flex size-7 items-center justify-center rounded-md text-nxa-muted-foreground outline-none transition-colors hover:bg-nxa-accent hover:text-nxa-foreground focus-visible:ring-2 focus-visible:ring-nxa-ring disabled:pointer-events-none disabled:opacity-40';

/**
 * The classes of an action bar that fades out while auto-hidden but stays in the tab order, and
 * stays shown while one of its menus is open.
 */
export const ACTION_BAR =
  'flex items-center gap-0.5 transition-opacity duration-150 data-[nxa-autohidden]:not-has-aria-expanded:opacity-0 motion-reduce:transition-none';
