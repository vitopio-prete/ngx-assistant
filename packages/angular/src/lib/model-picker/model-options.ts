/** A reasoning effort level a model supports. */
export interface ModelEffortOption {
  readonly id: string;
  readonly name: string;
}

/** The low, medium and high levels a model gets with `efforts: true`. */
export const DEFAULT_EFFORT_OPTIONS: readonly ModelEffortOption[] = [
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Med' },
  { id: 'high', name: 'High' },
];

/** A model the user can pick. `id` is what the runs ask for (`config.modelName`). */
export interface ModelOption {
  readonly id: string;
  readonly name: string;
  readonly description?: string | undefined;
  /** A disabled model is listed but cannot be picked. */
  readonly disabled?: boolean | undefined;
  /** Extra terms the search matches, in addition to the id and the name. */
  readonly keywords?: readonly string[] | undefined;
  /**
   * The reasoning effort levels the model supports: `true` for the default low, medium and high
   * levels, or a list. Leave it out for a model without configurable reasoning.
   */
  readonly efforts?: boolean | readonly ModelEffortOption[] | undefined;
}

/** The effort levels of a model, or `undefined` when its reasoning is not configurable. */
export function getModelEfforts(
  model: ModelOption | undefined,
): readonly ModelEffortOption[] | undefined {
  if (!model?.efforts) return undefined;
  if (model.efforts === true) return DEFAULT_EFFORT_OPTIONS;
  return model.efforts.length > 0 ? model.efforts : undefined;
}

/**
 * The effort that applies to a model: `effort` when the model supports it, else `undefined`. The
 * chosen effort stays across model switches; this resolves what the current model gets.
 */
export function resolveModelEffort(
  models: readonly ModelOption[],
  modelId: string | undefined,
  effort: string | undefined,
): string | undefined {
  if (effort === undefined) return undefined;
  const efforts = getModelEfforts(models.find((m) => m.id === modelId));
  return efforts?.some((e) => e.id === effort) ? effort : undefined;
}

/** Whether a model matches a search: its id, name or keywords contain the query, ignoring case. */
export function matchesModelQuery(model: ModelOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [model.id, model.name, ...(model.keywords ?? [])].some((term) =>
    term.toLowerCase().includes(needle),
  );
}
