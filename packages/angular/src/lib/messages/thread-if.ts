import { Directive, TemplateRef, ViewContainerRef, computed, inject, input } from '@angular/core';
import type { ThreadState } from '@ngx-assistant/engine';
import { fromRuntime } from '../from-runtime';
import { injectThread } from '../scopes';
import { conditionalView } from './conditional-view';

/**
 * The conditions of `*nxaThreadIf`. Every condition given must hold; a missing condition is not
 * checked.
 */
export interface NxaThreadIfConditions {
  /** The thread has no messages and is not loading them. */
  empty?: boolean;
  running?: boolean;
  disabled?: boolean;
}

const isEmpty = (s: ThreadState) => s.messages.length === 0 && !s.isLoading;

const matches = (when: NxaThreadIfConditions, s: ThreadState) =>
  (when.empty === undefined || when.empty === isEmpty(s)) &&
  (when.running === undefined || when.running === s.isRunning) &&
  (when.disabled === undefined || when.disabled === s.isDisabled);

/**
 * Renders its template while the nearest thread meets every condition given, and the `else`
 * template otherwise.
 *
 * @example
 * ```html
 * <p *nxaThreadIf="{ running: true }">Thinking…</p>
 * ```
 */
@Directive({ selector: '[nxaThreadIf]' })
export class NxaThreadIf {
  readonly nxaThreadIf = input.required<NxaThreadIfConditions>();
  readonly nxaThreadIfElse = input<TemplateRef<unknown> | null>(null);

  private readonly state = fromRuntime(injectThread());

  constructor() {
    conditionalView(
      inject(ViewContainerRef),
      inject(TemplateRef),
      computed(() => matches(this.nxaThreadIf(), this.state())),
      this.nxaThreadIfElse,
    );
  }
}

/**
 * Renders its template while the nearest thread has no messages and is not loading them.
 *
 * @example
 * ```html
 * <p *nxaThreadEmpty>How can I help?</p>
 * ```
 */
@Directive({ selector: '[nxaThreadEmpty]' })
export class NxaThreadEmpty {
  constructor() {
    const empty = fromRuntime(injectThread(), isEmpty);
    conditionalView(inject(ViewContainerRef), inject(TemplateRef), empty);
  }
}
