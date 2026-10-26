import { Injectable, computed, signal } from '@angular/core';
import type { ExternalStoreThreadData } from '@ngx-assistant/engine';

type Regular = ExternalStoreThreadData<'regular'>;
type Archived = ExternalStoreThreadData<'archived'>;

/**
 * The demo's list of conversations, kept in signals: which threads exist, their titles, which
 * ones are archived and which one is shown. The messages of each thread live in its own chat.
 */
@Injectable()
export class ThreadStore {
  private created = 0;
  private readonly regular = signal<readonly Regular[]>([]);
  private readonly archivedList = signal<readonly Archived[]>([]);
  private readonly main = signal('');

  readonly threads = this.regular.asReadonly();
  readonly archived = this.archivedList.asReadonly();
  readonly mainId = this.main.asReadonly();
  /** Every thread that still exists, archived ones included, in a stable order. */
  readonly ids = computed(() =>
    [...this.regular(), ...this.archivedList()].map((t) => t.id).sort(byCreation),
  );

  constructor() {
    this.create();
  }

  /** Shows a new conversation, or the one that has not started yet. */
  create() {
    const unstarted = this.regular().find((t) => !t.title);
    if (unstarted) {
      this.main.set(unstarted.id);
      return;
    }
    const id = `thread-${++this.created}`;
    this.regular.update((list) => [{ id, status: 'regular' }, ...list]);
    this.main.set(id);
  }

  switchTo(id: string) {
    if (this.regular().some((t) => t.id === id)) this.main.set(id);
  }

  rename(id: string, title: string) {
    this.regular.update((list) => list.map((t) => (t.id === id ? { ...t, title } : t)));
  }

  archive(id: string) {
    const thread = this.regular().find((t) => t.id === id);
    if (!thread) return;
    this.regular.update((list) => list.filter((t) => t.id !== id));
    this.archivedList.update((list) => [{ ...thread, status: 'archived' }, ...list]);
    this.leave(id);
  }

  unarchive(id: string) {
    const thread = this.archivedList().find((t) => t.id === id);
    if (!thread) return;
    this.archivedList.update((list) => list.filter((t) => t.id !== id));
    this.regular.update((list) => [{ ...thread, status: 'regular' }, ...list]);
  }

  delete(id: string) {
    this.regular.update((list) => list.filter((t) => t.id !== id));
    this.archivedList.update((list) => list.filter((t) => t.id !== id));
    this.leave(id);
  }

  // The shown thread went away: show the most recent one left, or start a new one.
  private leave(id: string) {
    if (this.main() !== id) return;
    const next = this.regular()[0];
    if (next) this.main.set(next.id);
    else this.create();
  }
}

const byCreation = (a: string, b: string) => Number(a.split('-')[1]) - Number(b.split('-')[1]);
