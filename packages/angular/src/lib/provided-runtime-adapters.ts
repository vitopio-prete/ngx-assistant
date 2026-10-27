import { InjectionToken } from '@angular/core';
import type { RuntimeAdapters } from '@ngx-assistant/engine';

/** The adapters of the nearest `provideRuntimeAdapters`, merged over the outer ones. */
export const NXA_PROVIDED_RUNTIME_ADAPTERS = new InjectionToken<
  Omit<RuntimeAdapters, 'modelContext'>
>('NXA_PROVIDED_RUNTIME_ADAPTERS');
