import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../testing/a11y';
import { NxaTooltip, TOOLTIP_OPEN_DELAY } from './tooltip';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NxaTooltip],
  template: `
    <div
      role="dialog"
      aria-label="Dialog"
      tabindex="-1"
      (keydown)="dialogKeys.push($event.key + ':' + $event.defaultPrevented)"
    >
      @if (shown()) {
        <button
          id="copy"
          type="button"
          [nxaTooltip]="text()"
          [attr.aria-label]="label()"
          [disabled]="disabled()"
          [attr.aria-expanded]="expanded()"
          [attr.aria-haspopup]="popup()"
          [nxaTooltipSide]="side()"
        >
          C
        </button>
      }
      <button id="other" type="button" nxaTooltip="Other">O</button>
      <div id="box" style="overflow: auto" [attr.hidden]="boxHidden() ? '' : null">
        <button id="inner" type="button" nxaTooltip="Inner">I</button>
      </div>
    </div>
  `,
})
class Host {
  readonly text = signal('Copy');
  readonly label = signal<string | null>('Copy');
  readonly disabled = signal(false);
  readonly expanded = signal<string | null>(null);
  readonly shown = signal(true);
  readonly popup = signal<string | null>('menu');
  readonly side = signal<'top' | 'bottom'>('top');
  readonly boxHidden = signal(false);
  readonly dialogKeys: string[] = [];
}

let fixture: ComponentFixture<Host>;
let clock = Date.now();

const button = (id = 'copy') => document.getElementById(id) as HTMLButtonElement;
const tooltips = () => [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')];
const tooltip = () => tooltips()[0];

const pointer = (target: Element, type: string, pointerType = 'mouse') => {
  const event = new Event(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave' });
  Object.assign(event, { pointerType });
  target.dispatchEvent(event);
};

/** A keyboard focus: jsdom matches :focus-visible only after a key press. */
const keyboardFocus = (target: HTMLElement) => {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  target.focus();
};

/** A mouse focus: a click moves the focus without :focus-visible. */
const mouseFocus = (target: HTMLElement) => {
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  target.focus();
};

const escape = (target: Element = document.activeElement ?? document.body) => {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

const flush = async () => {
  fixture.detectChanges();
  await fixture.whenStable();
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  // Starts outside the skip window of a tooltip closed by an earlier test or spec file.
  clock += 60_000;
  vi.setSystemTime(clock);
  fixture = TestBed.createComponent(Host);
  document.body.appendChild(fixture.nativeElement);
  await flush();
});

afterEach(() => {
  fixture.destroy();
  vi.useRealTimers();
});

describe('NxaTooltip', () => {
  it('opens after the pointer rests on the button, and closes when it leaves', () => {
    pointer(button(), 'pointerenter');
    vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY - 1);
    expect(tooltip()).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(tooltip()?.textContent?.trim()).toBe('Copy');

    pointer(button(), 'pointerleave');
    vi.advanceTimersByTime(200);
    expect(tooltip()).toBeUndefined();
  });

  it('does not open when the pointer leaves before the delay', () => {
    pointer(button(), 'pointerenter');
    vi.advanceTimersByTime(100);
    pointer(button(), 'pointerleave');
    vi.advanceTimersByTime(1000);
    expect(tooltip()).toBeUndefined();
  });

  it('stays open while the pointer moves onto the tooltip', () => {
    pointer(button(), 'pointerenter');
    vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY);
    pointer(button(), 'pointerleave');
    const pane = tooltip()!.parentElement!;
    pointer(pane, 'pointerenter');
    vi.advanceTimersByTime(500);
    expect(tooltip()).toBeDefined();

    pointer(pane, 'pointerleave');
    vi.advanceTimersByTime(200);
    expect(tooltip()).toBeUndefined();
  });

  it('opens the next tooltip at once when moving straight along the buttons', () => {
    pointer(button(), 'pointerenter');
    vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY);
    pointer(button(), 'pointerleave');
    pointer(button('other'), 'pointerenter');
    expect(tooltips().map((node) => node.textContent?.trim())).toEqual(['Other']);
  });

  it('opens the next tooltip at once just after the last one closed', () => {
    pointer(button(), 'pointerenter');
    vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY);
    pointer(button(), 'pointerleave');
    vi.advanceTimersByTime(150);
    expect(tooltip()).toBeUndefined();
    pointer(button('other'), 'pointerenter');
    expect(tooltip()?.textContent?.trim()).toBe('Other');
  });

  it('keeps one tooltip open at a time, so one Escape closes it', () => {
    pointer(button(), 'pointerenter');
    vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY);
    keyboardFocus(button('other'));
    expect(tooltips().map((node) => node.textContent?.trim())).toEqual(['Other']);
    escape(button('other'));
    expect(tooltips()).toEqual([]);
  });

  it('keeps a tooltip of the keyboard focus while the pointer passes over the button', () => {
    keyboardFocus(button());
    pointer(button(), 'pointerenter');
    pointer(button(), 'pointerleave');
    vi.advanceTimersByTime(1000);
    expect(tooltip()?.textContent?.trim()).toBe('Copy');
  });

  it('closes when a container scrolls', () => {
    keyboardFocus(button('inner'));
    expect(tooltip()).toBeDefined();
    document.getElementById('box')!.dispatchEvent(new Event('scroll'));
    expect(tooltip()).toBeUndefined();
  });

  it('closes when a container around the button is hidden', async () => {
    keyboardFocus(button('inner'));
    fixture.componentInstance.boxHidden.set(true);
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(tooltip()).toBeUndefined();
  });

  it('opens on the side it is given, also when the side changes', async () => {
    fixture.componentInstance.side.set('bottom');
    await flush();
    keyboardFocus(button());
    expect(tooltip()).toBeDefined();
    button().blur();
    fixture.componentInstance.side.set('top');
    await flush();
    keyboardFocus(button());
    expect(tooltips()).toHaveLength(1);
  });

  it('never opens from a touch', () => {
    pointer(button(), 'pointerenter', 'touch');
    vi.advanceTimersByTime(1000);
    expect(tooltip()).toBeUndefined();
  });

  it('opens at once on keyboard focus, not on mouse focus, and closes on blur', () => {
    mouseFocus(button());
    expect(tooltip()).toBeUndefined();
    button().blur();

    keyboardFocus(button());
    expect(tooltip()?.textContent?.trim()).toBe('Copy');
    button().blur();
    expect(tooltip()).toBeUndefined();
  });

  it('closes on Escape and keeps the Escape from the dialog around it', () => {
    keyboardFocus(button());
    const event = escape(button());
    expect(event.defaultPrevented).toBe(true);
    expect(tooltip()).toBeUndefined();
    expect(fixture.componentInstance.dialogKeys).toEqual(['Escape:true']);

    // With no tooltip open, the Escape goes on to the dialog.
    escape(button());
    expect(fixture.componentInstance.dialogKeys).toEqual(['Escape:true', 'Escape:false']);
  });

  it('closes on Escape while hovered, wherever the focus is', () => {
    pointer(button(), 'pointerenter');
    vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY);
    expect(escape(document.body).defaultPrevented).toBe(true);
    expect(tooltip()).toBeUndefined();
  });

  it('leaves an Escape with a modifier alone', () => {
    keyboardFocus(button());
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
      shiftKey: true,
    });
    button().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(tooltip()).toBeDefined();
  });

  it('leaves an Escape of an open IME alone', () => {
    keyboardFocus(button());
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    button().dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(tooltip()).toBeDefined();
  });

  it('closes when the button is pressed, and stays closed until the pointer leaves', () => {
    pointer(button(), 'pointerenter');
    vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY);
    pointer(button(), 'pointerdown');
    expect(tooltip()).toBeUndefined();
    pointer(button(), 'pointerenter');
    vi.advanceTimersByTime(1000);
    expect(tooltip()).toBeUndefined();

    pointer(button(), 'pointerleave');
    pointer(button(), 'pointerenter');
    vi.advanceTimersByTime(TOOLTIP_OPEN_DELAY);
    expect(tooltip()).toBeDefined();
  });

  it('stays open on a disclosure button that expands', async () => {
    fixture.componentInstance.popup.set(null);
    await flush();
    keyboardFocus(button());
    fixture.componentInstance.expanded.set('true');
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(tooltip()).toBeDefined();
  });

  it('closes when the button opens a menu or is disabled', async () => {
    keyboardFocus(button());
    fixture.componentInstance.expanded.set('true');
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(tooltip()).toBeUndefined();

    fixture.componentInstance.expanded.set(null);
    fixture.componentInstance.disabled.set(true);
    await flush();
    keyboardFocus(button());
    expect(tooltip()).toBeUndefined();
  });

  it('does not open with an empty text, and closes when the text empties', async () => {
    keyboardFocus(button());
    fixture.componentInstance.text.set('');
    await flush();
    expect(tooltip()).toBeUndefined();
    button().blur();
    keyboardFocus(button());
    expect(tooltip()).toBeUndefined();
  });

  it('follows a text that changes while open', async () => {
    keyboardFocus(button());
    fixture.componentInstance.text.set('Copied');
    fixture.componentInstance.label.set('Copied');
    await flush();
    expect(tooltip()?.textContent?.trim()).toBe('Copied');
  });

  it('is skipped by screen readers when its text is the name of the button', async () => {
    keyboardFocus(button());
    expect(tooltip()!.getAttribute('aria-hidden')).toBe('true');
    expect(button().hasAttribute('aria-describedby')).toBe(false);
    vi.useRealTimers(); // axe runs on timers
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('describes the button when its text differs from the name, keeping other ids', async () => {
    fixture.componentInstance.label.set('Copy message');
    await flush();
    button().setAttribute('aria-describedby', 'hint');
    keyboardFocus(button());
    const id = tooltip()!.id;
    expect(tooltip()!.hasAttribute('aria-hidden')).toBe(false);
    expect(button().getAttribute('aria-describedby')).toBe(`hint ${id}`);
    vi.useRealTimers(); // axe runs on timers
    expect(await axeViolations(document.body)).toEqual([]);

    button().blur();
    expect(button().getAttribute('aria-describedby')).toBe('hint');
  });

  it('closes and frees its overlay when the button is removed', async () => {
    keyboardFocus(button());
    expect(tooltip()).toBeDefined();
    fixture.componentInstance.shown.set(false);
    await flush();
    expect(tooltip()).toBeUndefined();
    expect(document.querySelector('.nxa-tooltip-pane')).toBeNull();
    expect(escape(document.body).defaultPrevented).toBe(false);
  });

  it('closes when the button is destroyed while its tooltip is about to open', async () => {
    pointer(button(), 'pointerenter');
    fixture.componentInstance.shown.set(false);
    await flush();
    vi.advanceTimersByTime(1000);
    expect(tooltip()).toBeUndefined();
  });
});
