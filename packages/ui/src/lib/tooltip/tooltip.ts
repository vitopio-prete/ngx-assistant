import {
  createFlexibleConnectedPositionStrategy,
  createOverlayRef,
  createRepositionScrollStrategy,
  type ConnectedPosition,
  type OverlayRef,
} from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  Injector,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';

/** The side of its button a tooltip opens on; it flips to the opposite side when there is no room. */
export type NxaTooltipSide = 'top' | 'bottom' | 'start' | 'end';

/** How long the pointer rests on a button before its tooltip opens. */
export const TOOLTIP_OPEN_DELAY = 300;

/** How long after a tooltip closes the next one opens at once (moving along a toolbar). */
const TOOLTIP_SKIP_DELAY = 300;

/** How long the pointer can take to move from the button onto its tooltip. */
const TOOLTIP_CLOSE_GRACE = 100;

const GAP = 6;

const POSITIONS: Record<NxaTooltipSide, ConnectedPosition> = {
  top: { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -GAP },
  bottom: {
    originX: 'center',
    originY: 'bottom',
    overlayX: 'center',
    overlayY: 'top',
    offsetY: GAP,
  },
  start: {
    originX: 'start',
    originY: 'center',
    overlayX: 'end',
    overlayY: 'center',
    offsetX: -GAP,
  },
  end: { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: GAP },
};

const OPPOSITE: Record<NxaTooltipSide, NxaTooltipSide> = {
  top: 'bottom',
  bottom: 'top',
  start: 'end',
  end: 'start',
};

/** When the last tooltip of the page closed, to open the next one without the delay. */
let lastClosedAt = Number.NEGATIVE_INFINITY;

/** The open tooltip of the page: one at a time, so a single Escape closes it. */
const page: { current: NxaTooltip | null } = { current: null };

let nextId = 0;

/** The panel of a tooltip, rendered in the CDK overlay at the end of the body. */
@Component({
  selector: 'nxa-tooltip-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'tooltip',
    'data-slot': 'tooltip',
    '[id]': 'id()',
    '[attr.aria-hidden]': 'hiddenFromReaders() ? "true" : null',
    class:
      'nxa-animate-in nxa-zoom-in-95 block max-w-64 rounded-md bg-nxa-foreground px-2 py-1 text-xs text-nxa-background shadow-sm',
  },
  template: `{{ text() }}`,
})
export class NxaTooltipPanel {
  readonly id = signal('');
  readonly text = signal('');
  readonly hiddenFromReaders = signal(false);
}

/**
 * Shows a short text beside a button: after the pointer rests on it, or at once when it gets the
 * focus from the keyboard. Escape closes it (without closing a dialog around the button), and the
 * pointer can move onto it without closing it. It never opens from a touch.
 *
 *   <button nxaTooltip="Copy" aria-label="Copy">...</button>
 *
 * When the text is the button's own accessible name, screen readers skip the tooltip (they would
 * read the name twice); otherwise the button is described by it while it is open.
 */
@Directive({
  selector: '[nxaTooltip]',
  host: {
    '(pointerenter)': 'onPointerEnter($event)',
    '(pointerleave)': 'scheduleClose()',
    '(pointerdown)': 'dismiss()',
    '(click)': 'dismiss()',
    '(focus)': 'onFocus()',
    '(blur)': 'onBlur()',
  },
})
export class NxaTooltip {
  /** The text of the tooltip. An empty text turns the tooltip off. */
  readonly text = input('', { alias: 'nxaTooltip' });

  /** The side of the button the tooltip opens on. */
  readonly side = input<NxaTooltipSide>('top', { alias: 'nxaTooltipSide' });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly id = `nxa-tooltip-${nextId++}`;

  private overlayRef: OverlayRef | null = null;
  private panel: NxaTooltipPanel | null = null;
  private openTimer: ReturnType<typeof setTimeout> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private observer: MutationObserver | null = null;
  private describedBy = false;
  private overlaySide: NxaTooltipSide | null = null;

  /** Whether the keyboard focus opened the tooltip: it then stays while the focus stays. */
  private byFocus = false;

  /** Set by a press: the tooltip stays closed until the pointer leaves or the focus moves. */
  private dismissed = false;

  /** Whether the tooltip is open. */
  readonly isOpen = signal(false);

  constructor() {
    effect(() => {
      const text = this.text();
      untracked(() => {
        if (!text.trim()) this.close();
        else if (this.panel) this.updatePanel(text);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.close();
      this.overlayRef?.dispose();
      this.overlayRef = null;
    });
  }

  protected onPointerEnter(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    this.cancelClose();
    if (this.isOpen() || this.dismissed) return;
    clearTimeout(this.openTimer);
    // Moving along a toolbar: another tooltip is open (or closing), or has just closed.
    if (page.current || Date.now() - lastClosedAt < TOOLTIP_SKIP_DELAY) this.open();
    else this.openTimer = setTimeout(() => this.open(), TOOLTIP_OPEN_DELAY);
  }

  protected onFocus(): void {
    this.dismissed = false;
    if (focusVisible(this.host)) {
      this.open();
      this.byFocus = this.isOpen();
    }
  }

  protected onBlur(): void {
    this.byFocus = false;
    this.close();
  }

  /** Closes the tooltip after a short grace, so the pointer can move onto it. */
  protected scheduleClose(): void {
    clearTimeout(this.openTimer);
    this.dismissed = false;
    // A tooltip of the keyboard focus stays while the focus stays, wherever the pointer goes.
    if (!this.isOpen() || this.byFocus) return;
    this.cancelClose();
    this.closeTimer = setTimeout(() => this.close(), TOOLTIP_CLOSE_GRACE);
  }

  /** Closes the tooltip when the button is pressed, until the pointer leaves it. */
  protected dismiss(): void {
    this.dismissed = true;
    this.close();
  }

  /** Opens the tooltip now. */
  open(): void {
    clearTimeout(this.openTimer);
    this.cancelClose();
    const text = this.text().trim();
    if (!text || this.isOpen() || !this.canOpen()) return;
    page.current?.close();
    page.current = this;

    if (this.overlayRef && this.overlaySide !== this.side()) {
      this.overlayRef.dispose();
      this.overlayRef = null;
    }
    const overlayRef = (this.overlayRef ??= this.createOverlay());
    const ref = overlayRef.attach(new ComponentPortal(NxaTooltipPanel, null, this.injector));
    this.panel = ref.instance;
    this.panel.id.set(this.id);
    this.updatePanel(text);
    ref.changeDetectorRef.detectChanges();

    const element = overlayRef.overlayElement;
    element.addEventListener('pointerenter', this.cancelClose);
    element.addEventListener('pointerleave', this.onPanelLeave);
    const document = this.host.ownerDocument;
    document.addEventListener('keydown', this.onKeydown, true);
    // A scroll of any container (the thread, a list) moves the button away from its tooltip.
    document.addEventListener('scroll', this.onScroll, true);
    this.observer ??= new MutationObserver(() => {
      if (!this.canOpen()) this.close();
    });
    // The button, or a container around it, can be disabled, hidden or made inert.
    this.observer.observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ['disabled', 'aria-disabled', 'aria-expanded', 'hidden', 'inert'],
    });
    this.isOpen.set(true);
  }

  /** Closes the tooltip now. */
  close(): void {
    clearTimeout(this.openTimer);
    this.cancelClose();
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    this.byFocus = false;
    if (page.current === this) page.current = null;
    lastClosedAt = Date.now();
    this.observer?.disconnect();
    this.host.ownerDocument.removeEventListener('keydown', this.onKeydown, true);
    this.host.ownerDocument.removeEventListener('scroll', this.onScroll, true);
    const overlayRef = this.overlayRef;
    if (overlayRef) {
      overlayRef.overlayElement.removeEventListener('pointerenter', this.cancelClose);
      overlayRef.overlayElement.removeEventListener('pointerleave', this.onPanelLeave);
      overlayRef.detach();
    }
    this.panel = null;
    this.setDescribedBy(false);
  }

  private readonly cancelClose = () => clearTimeout(this.closeTimer);

  private readonly onPanelLeave = () => this.scheduleClose();

  private readonly onKeydown = (event: KeyboardEvent) => {
    if (
      event.key !== 'Escape' ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.defaultPrevented ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    ) {
      return;
    }
    if (!this.host.isConnected) {
      // The button left the page without being destroyed: the Escape is not the tooltip's.
      this.close();
      return;
    }
    // The Escape is the tooltip's: a dialog around the button stays open.
    event.preventDefault();
    this.dismissed = true;
    this.close();
  };

  private readonly onScroll = (event: Event) => {
    const target = event.target;
    if (target instanceof Node && this.overlayRef?.overlayElement.contains(target)) return;
    this.close();
  };

  private canOpen(): boolean {
    const host = this.host;
    return (
      host.isConnected &&
      !host.hasAttribute('disabled') &&
      host.getAttribute('aria-disabled') !== 'true' &&
      // A menu open from the button covers its tooltip; a plain disclosure keeps it.
      !(host.hasAttribute('aria-haspopup') && host.getAttribute('aria-expanded') === 'true') &&
      !host.closest('[hidden], [inert]')
    );
  }

  private updatePanel(text: string): void {
    if (!this.panel) return;
    this.panel.text.set(text);
    const named = sameText(text, accessibleName(this.host));
    this.panel.hiddenFromReaders.set(named);
    this.setDescribedBy(!named);
  }

  private setDescribedBy(on: boolean): void {
    if (on === this.describedBy) return;
    this.describedBy = on;
    const ids = (this.host.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const next = on ? [...ids, this.id] : ids.filter((id) => id !== this.id);
    if (next.length) this.host.setAttribute('aria-describedby', next.join(' '));
    else this.host.removeAttribute('aria-describedby');
  }

  private createOverlay(): OverlayRef {
    const side = this.side();
    this.overlaySide = side;
    return createOverlayRef(this.injector, {
      positionStrategy: createFlexibleConnectedPositionStrategy(this.injector, this.host)
        .withPositions([POSITIONS[side], POSITIONS[OPPOSITE[side]]])
        .withFlexibleDimensions(false)
        .withPush(true)
        .withViewportMargin(8),
      scrollStrategy: createRepositionScrollStrategy(this.injector),
      panelClass: 'nxa-tooltip-pane',
    });
  }
}

const accessibleName = (host: HTMLElement): string => {
  const labelledBy = host.getAttribute('aria-labelledby');
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => host.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
  }
  return host.getAttribute('aria-label') ?? host.textContent ?? '';
};

const normalize = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase();

const sameText = (a: string, b: string): boolean => normalize(a) === normalize(b);

const focusVisible = (element: HTMLElement): boolean => {
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
};
