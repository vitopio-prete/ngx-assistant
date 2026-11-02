import type { ConnectedPosition } from '@angular/cdk/overlay';

/*
 * The look of the menus of the components, built on `@angular/cdk/menu`: a trigger with
 * `[cdkMenuTriggerFor]`, a panel with `cdkMenu` and buttons with `cdkMenuItem`. The CDK gives the
 * keyboard (arrows, Home/End, typeahead, Escape back to the trigger) and the ARIA roles; the
 * panel opens in the CDK overlay, at the end of the body.
 */

/** The classes of a menu panel. */
export const MENU_PANEL =
  'flex min-w-36 flex-col rounded-xl border border-nxa-border bg-nxa-background p-1.5 text-nxa-foreground shadow-lg outline-none';

/** The classes of a menu item. */
export const MENU_ITEM =
  'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-sm outline-none select-none hover:bg-nxa-accent hover:text-nxa-accent-foreground focus:bg-nxa-accent focus:text-nxa-accent-foreground disabled:pointer-events-none disabled:opacity-50';

/** The classes of a menu item that destroys something. */
export const MENU_ITEM_DESTRUCTIVE = `${MENU_ITEM} text-nxa-destructive hover:text-nxa-destructive focus:text-nxa-destructive`;

/** Opens a menu beside its trigger (to the end, then to the start), aligned to its top. */
export const MENU_BESIDE: ConnectedPosition[] = [
  { originX: 'end', originY: 'top', overlayX: 'start', overlayY: 'top', offsetX: 6 },
  { originX: 'start', originY: 'top', overlayX: 'end', overlayY: 'top', offsetX: -6 },
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
];

/** Opens a menu below its trigger (above when there is no room), aligned to its start. */
export const MENU_BELOW: ConnectedPosition[] = [
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
  { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
];
