import { Injectable, computed, inject, resource } from '@angular/core';
import type { ModelOption } from '@ngx-assistant/angular';
import type { OpenRouterModel } from '../backend/openrouter-models';
import { OpenRouterAccount } from './openrouter-account';
import { providerIcon } from './provider-icons';

/** A small stroked icon as a `data:` URL, for the `icon` of a simulated model. */
const icon = (color: string, path: string) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" ` +
      `stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`,
  );

/** The models the backend simulates: always there, with or without an OpenRouter account. */
export const SIMULATED_MODELS: readonly ModelOption[] = [
  {
    id: 'showcase',
    name: 'Showcase',
    description: 'Simulated · markdown, code and tools',
    icon: icon(
      '#7c3aed',
      'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
    ),
    efforts: true,
  },
  {
    id: 'echo',
    name: 'Echo',
    description: 'Simulated · repeats your message',
    icon: icon('#0d9488', 'M3 12h2 M7 8v8 M11 5v14 M15 8v8 M19 11v2'),
    efforts: true,
  },
];

/** The model picked on a first visit, and when the one picked before cannot be used. */
export const DEFAULT_MODEL = 'showcase';

/** What the selector says under a free model that needs an account first. */
export const SIGN_IN_TO_USE = 'Sign in to use';

/** "262K context", "1M context". */
function contextSize(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M context`;
  return `${Math.round(tokens / 1000)}K context`;
}

function toOption(model: OpenRouterModel, connected: boolean): ModelOption {
  const openRouterId = model.id.slice(model.id.indexOf('/') + 1);
  const traits = [
    model.contextLength ? contextSize(model.contextLength) : undefined,
    model.tools ? 'tools' : undefined,
    model.images ? 'images' : undefined,
  ].filter(Boolean);
  return {
    id: model.id,
    name: model.name,
    icon: providerIcon(openRouterId),
    description: connected ? ['Free', ...traits].join(' · ') : SIGN_IN_TO_USE,
    disabled: !connected,
    keywords: [openRouterId, 'openrouter', 'free'],
    ...(model.reasoning ? { efforts: true } : {}),
  };
}

/**
 * The models of the selector: the simulated ones, then the free models of OpenRouter, which the
 * backend lists at `GET /api/models`. They can be picked once an OpenRouter account is connected.
 */
@Injectable({ providedIn: 'root' })
export class DemoModels {
  private readonly account = inject(OpenRouterAccount);

  private readonly openRouter = resource({
    loader: async ({ abortSignal }) => {
      const response = await fetch('/api/models', { signal: abortSignal });
      if (!response.ok) throw new Error(await response.text());
      return ((await response.json()) as { openrouter: OpenRouterModel[] }).openrouter;
    },
  });

  /** Why the OpenRouter models could not be listed, if they could not. */
  readonly error = computed(() => {
    const error = this.openRouter.error();
    return error ? error.message || 'Could not load the OpenRouter models.' : undefined;
  });

  /** Tries the OpenRouter models again after a failure. */
  retry() {
    if (this.openRouter.error()) this.openRouter.reload();
  }

  readonly options = computed<readonly ModelOption[]>(() => {
    const connected = this.account.connected();
    const remote = this.openRouter.hasValue() ? this.openRouter.value() : [];
    return [...SIMULATED_MODELS, ...remote.map((model) => toOption(model, connected))];
  });
}
