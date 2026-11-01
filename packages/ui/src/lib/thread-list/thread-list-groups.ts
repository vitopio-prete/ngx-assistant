/** The title a thread without one shows, and is searched by. */
export const UNTITLED_THREAD = 'New Chat';

/** A run of threads under one day label; no label when the threads carry no dates. */
export interface ThreadListGroup {
  readonly label: string | undefined;
  readonly ids: readonly string[];
}

/** What a thread needs for the search and the grouping. */
export interface ThreadListGroupItem {
  readonly title?: string | undefined;
  readonly lastMessageAt?: Date | undefined;
}

/** The start of the local day of `time`, in milliseconds. */
export const startOfDay = (time: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** The start of the local day after the one of `time`, whatever its length (DST). */
export const startOfNextDay = (time: number) => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
};

const dayLabel = (date: Date | undefined, startOfToday: number, startOfYesterday: number) => {
  if (!date || date.getTime() >= startOfToday) return 'Today';
  if (date.getTime() >= startOfYesterday) return 'Yesterday';
  return 'Earlier';
};

/**
 * Filters the threads by `query` (in the title, or the untitled fallback, ignoring case and the
 * spaces at its ends) and groups them by day: Today, Yesterday, Earlier, newest first, with a
 * thread without a date under Today. When no matching thread has a date, or `startOfToday` is
 * not known, there is one group without a label, in the order of the runtime.
 */
export function groupThreads(
  ids: readonly string[],
  items: Readonly<Record<string, ThreadListGroupItem | undefined>>,
  query: string,
  startOfToday: number | undefined,
): { matches: readonly string[]; groups: readonly ThreadListGroup[] } {
  const needle = query.trim().toLowerCase();
  const matches = ids.filter(
    (id) => !needle || (items[id]?.title || UNTITLED_THREAD).toLowerCase().includes(needle),
  );
  const date = (id: string) => items[id]?.lastMessageAt;
  if (startOfToday === undefined || !matches.some((id) => date(id))) {
    return { matches, groups: [{ label: undefined, ids: matches }] };
  }

  const yesterday = new Date(startOfToday);
  yesterday.setDate(yesterday.getDate() - 1);
  const startOfYesterday = yesterday.getTime();
  const time = (id: string) => date(id)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...matches].sort((a, b) => time(b) - time(a));
  const groups: { label: string; ids: string[] }[] = [];
  for (const id of sorted) {
    const label = dayLabel(date(id), startOfToday, startOfYesterday);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.ids.push(id);
    else groups.push({ label, ids: [id] });
  }
  return { matches, groups };
}
