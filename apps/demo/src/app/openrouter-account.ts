import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, resource, signal } from '@angular/core';
import { OpenRouterLimit } from './openrouter-limit';

const AUTH_URL = 'https://openrouter.ai/auth';
const KEYS_URL = 'https://openrouter.ai/api/v1/auth/keys';
const KEY_URL = 'https://openrouter.ai/api/v1/key';

/** Where the visitor manages the keys of the account, and deletes the one of the demo. */
export const OPENROUTER_KEYS_PAGE = 'https://openrouter.ai/settings/keys';

/** What OpenRouter says about the key in use, as far as the demo reads it. */
interface KeyInfo {
  label?: string;
  is_free_tier?: boolean;
}

/** Where the key of the visitor is kept: in this browser only. */
export const OPENROUTER_KEY_STORAGE = 'ngx-assistant-demo-openrouter-key';
/**
 * The verifier and the state of a sign-in on its way, until OpenRouter sends the visitor back: in
 * the session of this tab, which the redirect keeps and other tabs do not share.
 */
export const OPENROUTER_SIGN_IN_STORAGE = 'ngx-assistant-demo-openrouter-sign-in';

interface PendingSignIn {
  verifier: string;
  state: string;
}

type StorageName = 'localStorage' | 'sessionStorage';

function read(key: string, storage: StorageName = 'localStorage'): string | null {
  try {
    return globalThis[storage].getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null, storage: StorageName = 'localStorage') {
  try {
    if (value === null) globalThis[storage].removeItem(key);
    else globalThis[storage].setItem(key, value);
  } catch {
    // Storage can be blocked: the key then lasts as long as the page.
  }
}

/** The key in use, for the requests the runtimes make outside of the injector. */
let currentKey: string | undefined;

/** The `Authorization` header of the requests to the backend: the key, once one is connected. */
export function openRouterHeaders(): Record<string, string> {
  return currentKey ? { Authorization: `Bearer ${currentKey}` } : {};
}

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const randomString = () => base64Url(crypto.getRandomValues(new Uint8Array(32)));

/** The S256 code challenge of a PKCE verifier. */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/**
 * The OpenRouter account of the visitor, which the free models run on: the demo has no key and no
 * server of its own. The key comes from OpenRouter's sign-in (OAuth with PKCE, all in the browser)
 * or is pasted, and stays in this browser's storage until the visitor disconnects.
 */
@Injectable({ providedIn: 'root' })
export class OpenRouterAccount {
  private readonly document = inject(DOCUMENT);
  private readonly limit = inject(OpenRouterLimit);

  private readonly apiKey = signal((currentKey = read(OPENROUTER_KEY_STORAGE) ?? undefined));
  /** Set while the code OpenRouter sent back is exchanged for a key. */
  readonly connecting = signal(false);
  /** Why the last sign-in failed, until the next one. */
  readonly error = signal<string | undefined>(undefined);

  readonly connected = computed(() => this.apiKey() !== undefined);
  /** The key, for the `Authorization` header of the requests to the backend. */
  readonly key = this.apiKey.asReadonly();

  /** What OpenRouter says about the key: its name, and whether the account is on the free tier. */
  private readonly keyInfo = resource({
    params: () => this.apiKey(),
    loader: async ({ params: key, abortSignal }): Promise<KeyInfo> => {
      const response = await fetch(KEY_URL, {
        headers: { Authorization: `Bearer ${key}` },
        signal: abortSignal,
      });
      if (!response.ok) throw new Error(`OpenRouter answered ${response.status}`);
      return ((await response.json()) as { data?: KeyInfo }).data ?? {};
    },
  });

  /**
   * The name of the account row: the name of the key on OpenRouter, or the key with all but its last
   * characters hidden while OpenRouter has not said (or cannot be reached).
   */
  readonly label = computed(() => {
    const key = this.apiKey();
    if (key === undefined) return undefined;
    const info = this.keyInfo.hasValue() ? this.keyInfo.value() : undefined;
    return info?.label?.trim() || `sk-or-…${key.slice(-4)}`;
  });

  /** Whether the account is on the free tier of OpenRouter, once OpenRouter has said. */
  readonly freeTier = computed(() =>
    this.keyInfo.hasValue() ? this.keyInfo.value().is_free_tier : undefined,
  );

  /**
   * The address of OpenRouter's sign-in, which sends the visitor back to this page with a code. A
   * new verifier is kept for each address, so only the last one made can finish.
   */
  async signInUrl(): Promise<string> {
    const pending: PendingSignIn = { verifier: randomString(), state: randomString() };
    write(OPENROUTER_SIGN_IN_STORAGE, JSON.stringify(pending), 'sessionStorage');
    const url = new URL(AUTH_URL);
    url.searchParams.set('callback_url', this.pageUrl().href);
    url.searchParams.set('code_challenge', await codeChallenge(pending.verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', pending.state);
    return url.href;
  }

  /**
   * Finishes a sign-in when OpenRouter sent the visitor back: takes the code and the state off the
   * address, checks the state and exchanges the code for a key. Does nothing on any other visit.
   */
  async completeSignIn(): Promise<void> {
    const location = this.document.location;
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (code === null) return;
    const state = params.get('state');
    // The code is single use: it leaves the address before anything else, so a reload cannot reuse it.
    this.document.defaultView?.history.replaceState(null, '', this.pageUrl().href);

    const pending = this.takePending();
    if (!pending || state !== pending.state) {
      this.error.set('The OpenRouter sign-in did not start here. Try to sign in again.');
      return;
    }
    this.connecting.set(true);
    this.error.set(undefined);
    try {
      const response = await fetch(KEYS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          code_verifier: pending.verifier,
          code_challenge_method: 'S256',
        }),
      });
      if (!response.ok) throw new Error(`OpenRouter answered ${response.status}`);
      const { key } = (await response.json()) as { key?: string };
      if (!key) throw new Error('OpenRouter sent no key');
      this.useKey(key);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.error.set(`The OpenRouter sign-in failed: ${reason}.`);
    } finally {
      this.connecting.set(false);
    }
  }

  /** Uses a key pasted by the visitor. */
  useKey(key: string) {
    const trimmed = key.trim();
    if (!trimmed) return;
    write(OPENROUTER_KEY_STORAGE, trimmed);
    // The daily limit belongs to the account it was reached on.
    if (trimmed !== this.apiKey()) this.limit.clear();
    this.apiKey.set((currentKey = trimmed));
    this.error.set(undefined);
  }

  /** Forgets the key. It still works on OpenRouter until the visitor deletes it there. */
  disconnect() {
    write(OPENROUTER_KEY_STORAGE, null);
    this.limit.clear();
    this.apiKey.set((currentKey = undefined));
  }

  private takePending(): PendingSignIn | undefined {
    const stored = read(OPENROUTER_SIGN_IN_STORAGE, 'sessionStorage');
    write(OPENROUTER_SIGN_IN_STORAGE, null, 'sessionStorage');
    try {
      const pending = stored ? (JSON.parse(stored) as Partial<PendingSignIn>) : undefined;
      return pending?.verifier && pending.state ? (pending as PendingSignIn) : undefined;
    } catch {
      return undefined;
    }
  }

  /** This page without its query and hash: where OpenRouter sends the visitor back. */
  private pageUrl(): URL {
    const url = new URL(this.document.location.href);
    url.search = '';
    url.hash = '';
    return url;
  }
}
