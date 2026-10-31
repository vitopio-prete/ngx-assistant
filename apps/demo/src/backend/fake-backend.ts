import { chat } from './chat';
import { BackendStore } from './storage';
import { threads } from './threads';

const LATENCY_MS = 30;

/**
 * Serves the demo's backend from the page itself, so the demo stays a static site: requests to
 * `/api/` get the responses a real server would send, and every other request goes to the network.
 * The app talks to it with plain `fetch`, as it would to a server; pointing the runtimes at a real
 * backend needs no other change.
 */
export function installFakeBackend() {
  const storage = new BackendStore();
  const network = globalThis.fetch?.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      globalThis.location?.href,
    );
    if (url.origin !== globalThis.location?.origin || !url.pathname.startsWith('/api/')) {
      if (!network) throw new TypeError(`No network to fetch ${url.href}`);
      return network(input, init);
    }

    const request = typeof input === 'object' && 'method' in input ? input : undefined;
    const signal = init?.signal ?? request?.signal ?? null;
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : ((await request?.text()) ?? '');
    await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
    if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');

    const [route, ...segments] = url.pathname
      .slice('/api/'.length)
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    try {
      if (route === 'chat' && method === 'POST') return await chat(body, signal);
      if (route === 'threads') return await threads(storage, method, segments, body, signal);
      return new Response('Not found', { status: 404 });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), { status: 500 });
    }
  };
}
