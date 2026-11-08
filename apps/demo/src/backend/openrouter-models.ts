/** The models list of OpenRouter: public, no key needed. */
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** The prefix of the model ids the backend sends to OpenRouter, e.g. `openrouter/google/gemma`. */
export const OPENROUTER_PREFIX = 'openrouter/';

/** A free model of OpenRouter, as `GET /api/models` lists it. */
export interface OpenRouterModel {
  /** The id the runs ask for: {@link OPENROUTER_PREFIX} and the id on OpenRouter. */
  id: string;
  /** Its name on OpenRouter, without the "(free)" every model of the list has. */
  name: string;
  contextLength?: number;
  /** Whether it takes tools: the backend gives it `get_weather` and `send_email`. */
  tools: boolean;
  /** Whether its reasoning effort can be set. */
  reasoning: boolean;
  /** Whether it takes images. */
  images: boolean;
}

/** What `GET /api/v1/models` answers, as far as the demo reads it. */
interface CatalogEntry {
  id: string;
  name?: string;
  context_length?: number;
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
}

export type Network = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let catalog: Promise<OpenRouterModel[]> | undefined;

/**
 * The free models of OpenRouter that answer in text, by name. The list changes often, so it is
 * read from OpenRouter once per page and kept for the page; a failed read is tried again next time.
 */
export function openRouterModels(network: Network): Promise<OpenRouterModel[]> {
  catalog ??= loadModels(network).catch((error: unknown) => {
    catalog = undefined;
    throw error;
  });
  return catalog;
}

async function loadModels(network: Network): Promise<OpenRouterModel[]> {
  const response = await network(OPENROUTER_MODELS_URL);
  if (!response.ok) throw new Error(`OpenRouter answered ${response.status}`);
  const { data } = (await response.json()) as { data?: CatalogEntry[] };
  return (data ?? [])
    .filter(
      (entry) =>
        entry.id.endsWith(':free') &&
        (entry.architecture?.output_modalities ?? ['text']).includes('text'),
    )
    .map((entry) => ({
      id: OPENROUTER_PREFIX + entry.id,
      name: (entry.name ?? entry.id).replace(/\s*\(free\)\s*$/i, ''),
      ...(entry.context_length ? { contextLength: entry.context_length } : {}),
      tools: entry.supported_parameters?.includes('tools') ?? false,
      reasoning: entry.supported_parameters?.includes('reasoning') ?? false,
      images: entry.architecture?.input_modalities?.includes('image') ?? false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `GET /api/models`: the OpenRouter models the backend can talk to. */
export async function models(network: Network): Promise<Response> {
  try {
    return Response.json({ openrouter: await openRouterModels(network) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return new Response(`Could not load the OpenRouter models: ${reason}`, { status: 502 });
  }
}
