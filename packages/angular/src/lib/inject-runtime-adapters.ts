import { inject } from '@angular/core';
import type { RuntimeAdapters } from '@ngx-assistant/engine';
import { NXA_PROVIDED_RUNTIME_ADAPTERS } from './provided-runtime-adapters';
import { NXA_RUNTIME_ADAPTERS } from './runtime-adapters';

/**
 * The adapters the runtime providers of the current injector merge under their own: the thread
 * list's, then those of `provideRuntimeAdapters`. Not part of the public API.
 */
export function injectRuntimeAdapters(): RuntimeAdapters {
  // The model context always comes from the list, whatever an untyped caller provided.
  const list = inject(NXA_RUNTIME_ADAPTERS, { optional: true });
  return {
    ...list,
    ...inject(NXA_PROVIDED_RUNTIME_ADAPTERS, { optional: true }),
    modelContext: list?.modelContext,
  };
}
