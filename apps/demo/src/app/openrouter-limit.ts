import { Injectable, computed, signal } from '@angular/core';
import { LIMIT_RESET_HEADER, LIMIT_SCOPE_HEADER } from '../backend/openrouter-chat';

/** Where the end of the daily limit is kept, so a reload still knows it: in this browser only. */
export const OPENROUTER_LIMIT_STORAGE = 'ngx-assistant-demo-openrouter-limit';

function readStored(): number | undefined {
  try {
    const value = Number(globalThis.localStorage.getItem(OPENROUTER_LIMIT_STORAGE));
    return Number.isFinite(value) && value > Date.now() ? value : undefined;
  } catch {
    return undefined;
  }
}

function store(value: number | undefined) {
  try {
    if (value === undefined) globalThis.localStorage.removeItem(OPENROUTER_LIMIT_STORAGE);
    else globalThis.localStorage.setItem(OPENROUTER_LIMIT_STORAGE, String(value));
  } catch {
    // Storage can be blocked: the limit is then known until a reload.
  }
}

/** The next midnight UTC, when OpenRouter resets the daily limits when it does not say. */
function nextMidnightUtc(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

/** When the daily limit of the free models of OpenRouter ends, while it is reached. */
const resetAt = signal<number | undefined>(readStored());
let timer: ReturnType<typeof setTimeout> | undefined;

function setResetAt(value: number | undefined) {
  clearTimeout(timer);
  timer = undefined;
  resetAt.set(value);
  store(value);
  // The limit ends on its own at its reset; timers cannot wait longer than about 24 days.
  if (value !== undefined)
    timer = setTimeout(() => setResetAt(undefined), Math.min(value - Date.now(), 2 ** 31 - 1));
}
if (resetAt() !== undefined) setResetAt(resetAt());

/**
 * The `onResponse` of the runtimes: a 429 the backend marks as the daily limit of the free models
 * of OpenRouter starts the limit, until the reset it gives (or the next midnight UTC).
 */
export function watchOpenRouterLimit(response: Response): void {
  if (response.status !== 429 || response.headers.get(LIMIT_SCOPE_HEADER) !== 'day') return;
  const now = Date.now();
  const reset = Number(response.headers.get(LIMIT_RESET_HEADER));
  setResetAt(Number.isFinite(reset) && reset > now ? reset : nextMidnightUtc(now));
}

/**
 * The daily limit of the free models of OpenRouter (50 requests a day on an account without
 * credits), as OpenRouter reported it: the app shows a notice above the composer while it lasts.
 */
@Injectable({ providedIn: 'root' })
export class OpenRouterLimit {
  /** When the limit ends, while it is reached. */
  readonly resetAt = resetAt.asReadonly();
  readonly reached = computed(() => resetAt() !== undefined);

  /** Forgets the limit: another account has its own. */
  clear() {
    setResetAt(undefined);
  }
}
