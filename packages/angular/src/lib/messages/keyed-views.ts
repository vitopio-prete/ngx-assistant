import {
  EmbeddedViewRef,
  Injector,
  Provider,
  Signal,
  TemplateRef,
  ViewContainerRef,
  untracked,
} from '@angular/core';
import { fromRuntime, type RuntimeSubscribable } from '../from-runtime';

/** The template context of a row rendered by a list primitive. */
export interface NxaRowContext<S> {
  /** The row's state, live. */
  $implicit: Signal<S>;
  /** The row's position in the list. */
  index: number;
  /** The number of rows. */
  count: number;
  first: boolean;
  last: boolean;
}

/** One row a list wants rendered: its key, and how to create its runtime. */
export interface KeyedRow<R> {
  key: string;
  create(): R;
}

interface Row<S> {
  view: EmbeddedViewRef<NxaRowContext<S>>;
  injector: Injector & { destroy(): void };
}

/**
 * Keeps one embedded view per key in a view container. A row keeps its view, and the runtime it
 * was created with, while its key stays in the list; it moves with the key, and a new key creates
 * a new row. The keys of one update must be unique. Each row has its own injector with the row's
 * scope, destroyed with the row, which ends the subscriptions made in it.
 */
export class KeyedViews<S, R extends RuntimeSubscribable<S>> {
  private readonly rows = new Map<string, Row<S>>();

  constructor(
    private readonly container: ViewContainerRef,
    private readonly template: TemplateRef<NxaRowContext<S>>,
    private readonly parent: Injector,
    private readonly scope: (factory: () => R) => Provider[],
  ) {}

  update(next: readonly KeyedRow<R>[]) {
    untracked(() => this.reconcile(next));
  }

  clear() {
    for (const row of this.rows.values()) this.destroy(row);
    this.rows.clear();
  }

  private reconcile(next: readonly KeyedRow<R>[]) {
    const keys = new Set(next.map((row) => row.key));
    for (const [key, row] of this.rows) {
      if (keys.has(key)) continue;
      this.destroy(row);
      this.rows.delete(key);
    }

    const count = next.length;
    next.forEach((entry, index) => {
      let row = this.rows.get(entry.key);
      if (!row) {
        row = this.create(entry, index, count);
        this.rows.set(entry.key, row);
        return;
      }
      if (this.container.indexOf(row.view) !== index) this.container.move(row.view, index);
      const context = row.view.context;
      const first = index === 0;
      const last = index === count - 1;
      if (
        context.index !== index ||
        context.count !== count ||
        context.first !== first ||
        context.last !== last
      ) {
        Object.assign(context, { index, count, first, last });
        row.view.markForCheck();
      }
    });
  }

  private create(entry: KeyedRow<R>, index: number, count: number): Row<S> {
    const runtime = entry.create();
    const injector = Injector.create({
      providers: this.scope(() => runtime),
      parent: this.parent,
    }) as Injector & { destroy(): void };
    const state = fromRuntime(runtime, undefined, { injector });
    const view = this.container.createEmbeddedView(
      this.template,
      { $implicit: state, index, count, first: index === 0, last: index === count - 1 },
      { index, injector },
    );
    return { view, injector };
  }

  private destroy(row: Row<S>) {
    row.view.destroy();
    row.injector.destroy();
  }
}
