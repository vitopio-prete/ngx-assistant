import { InjectionToken, Provider, Type, inject, signal } from '@angular/core';

/** A component that renders tool calls. It reads its call with `injectToolCall()`. */
export type ToolUiComponent = Type<unknown>;

/** What `provideToolUi(...)` declares: the UI of one tool, or the UI of tools without one. */
export type ToolUiDeclaration =
  | { readonly toolName: string; readonly component: ToolUiComponent }
  | { readonly fallback: ToolUiComponent };

// Identity is the removal key: registering the same component twice gives two registrations,
// each removed by its own dispose.
interface Registration {
  readonly component: ToolUiComponent;
}

const FALLBACK = Symbol('fallback');
type RegistryKey = string | typeof FALLBACK;

/**
 * The tool UIs of one level of the injector tree. A lookup tries this level, then the levels
 * above it: a nearer registration wins. Within a level, UIs registered at runtime come before the
 * declared ones, and among each the first one wins. A tool name looks for its own UI through every
 * level before any fallback is used.
 *
 * Registrations are signals: a part rendered by `*nxaMessageParts` swaps to a UI registered after
 * it, and back when the registration is removed.
 */
export class ToolUiRegistry {
  private readonly declared = new Map<RegistryKey, ToolUiComponent>();
  private readonly registrations = signal<ReadonlyMap<RegistryKey, readonly Registration[]>>(
    new Map(),
  );

  constructor(
    private readonly parent: ToolUiRegistry | null = null,
    declarations: readonly ToolUiDeclaration[] = [],
  ) {
    for (const declaration of declarations) {
      const key = 'fallback' in declaration ? FALLBACK : declaration.toolName;
      const component = 'fallback' in declaration ? declaration.fallback : declaration.component;
      if (!this.declared.has(key)) this.declared.set(key, component);
    }
  }

  /** Registers the UI of a tool. Returns the function that removes this registration. */
  register(toolName: string, component: ToolUiComponent): () => void {
    return this.add(toolName, component);
  }

  /** Registers the UI of the tools without one. Returns the function that removes it. */
  registerFallback(component: ToolUiComponent): () => void {
    return this.add(FALLBACK, component);
  }

  /** The UI of a tool: its registration, else a fallback, else `null`. Tracked when read. */
  resolve(toolName: string): ToolUiComponent | null {
    return this.find(toolName) ?? this.find(FALLBACK);
  }

  private find(key: RegistryKey): ToolUiComponent | null {
    return (
      this.registrations().get(key)?.[0]?.component ??
      this.declared.get(key) ??
      this.parent?.find(key) ??
      null
    );
  }

  private add(key: RegistryKey, component: ToolUiComponent): () => void {
    const registration: Registration = { component };
    this.registrations.update((all) =>
      new Map(all).set(key, [...(all.get(key) ?? []), registration]),
    );
    return () =>
      this.registrations.update((all) => {
        const current = all.get(key);
        if (!current?.includes(registration)) return all;
        const next = new Map(all);
        const rest = current.filter((r) => r !== registration);
        // An emptied name goes away, so mounting and unmounting tools does not pile up keys.
        if (rest.length > 0) next.set(key, rest);
        else next.delete(key);
        return next;
      });
  }
}

export const NXA_TOOL_UI_REGISTRY = new InjectionToken<ToolUiRegistry>('NXA_TOOL_UI_REGISTRY');

/**
 * The registry of the level of the nearest assistant scope, set by every assistant scope. A tool
 * registered with the model context of a runtime puts its UI there, so the UI applies wherever
 * that runtime's messages render. Not part of the public API.
 */
export const NXA_ASSISTANT_TOOL_UI_REGISTRY = new InjectionToken<ToolUiRegistry>(
  'NXA_ASSISTANT_TOOL_UI_REGISTRY',
);

const NXA_TOOL_UI_DECLARATIONS = new InjectionToken<readonly ToolUiDeclaration[]>(
  'NXA_TOOL_UI_DECLARATIONS',
);

/**
 * Provides the registry of one level: the declarations of this level, chained to the registry
 * above. Every `provideToolUi(...)` and every assistant scope includes it, so the level has one
 * registry however many of them it lists.
 */
export const TOOL_UI_REGISTRY_PROVIDER: Provider = {
  provide: NXA_TOOL_UI_REGISTRY,
  useFactory: () =>
    new ToolUiRegistry(
      inject(NXA_TOOL_UI_REGISTRY, { skipSelf: true, optional: true }),
      inject(NXA_TOOL_UI_DECLARATIONS, { self: true, optional: true }) ?? [],
    ),
};

/**
 * Declares the component that renders the calls of a tool, or with `fallback` the component for
 * tools without one. Goes in the `providers` of the application, a route or a component; the
 * declarations of a nearer level win over the ones above it.
 *
 * `*nxaMessageParts` renders a `tool-call` part with the registered component instead of its
 * template; without a registration nor a fallback, the template renders the part.
 *
 * @example
 * ```ts
 * providers: [
 *   provideToolUi({ toolName: 'get_weather', component: WeatherCard }),
 *   provideToolUi({ fallback: ToolCallCard }),
 * ]
 * ```
 */
export function provideToolUi(declaration: ToolUiDeclaration): Provider[] {
  return [
    { provide: NXA_TOOL_UI_DECLARATIONS, multi: true, useValue: declaration },
    TOOL_UI_REGISTRY_PROVIDER,
  ];
}

/**
 * The nearest tool UI registry, to register a UI at runtime. Each assistant scope has its own,
 * chained to the levels above it, so a nested assistant scope also sees the outer UIs. A runtime
 * registration comes before the UIs declared at its level; remove it when its owner is destroyed.
 *
 * @example
 * ```ts
 * const dispose = injectToolUiRegistry().register('get_weather', WeatherCard);
 * inject(DestroyRef).onDestroy(dispose);
 * ```
 */
export function injectToolUiRegistry(): ToolUiRegistry {
  const registry = inject(NXA_TOOL_UI_REGISTRY, { optional: true });
  if (!registry) {
    throw new Error(
      '[ngx-assistant] No tool UI registry here: provide a runtime or provideToolUi(...) on an ancestor.',
    );
  }
  return registry;
}
