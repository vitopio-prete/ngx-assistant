/**
 * The logo of the maker of an OpenRouter model, from `public/providers/` (Lobe Icons, MIT). The
 * names and logos are trademarks of their owners and only say which model is which.
 */
const FAMILIES: readonly (readonly [prefix: string, icon: string])[] = [
  ['google/gemma', 'gemma-color'],
  ['google/gemini', 'gemini-color'],
  ['google/', 'google-color'],
  ['nvidia/', 'nvidia-color'],
  ['cohere/', 'cohere-color'],
  ['liquid/', 'liquid'],
  ['minimax/', 'minimax-color'],
  ['meta-llama/', 'meta-color'],
  ['mistralai/', 'mistral-color'],
  ['qwen/', 'qwen-color'],
  ['deepseek/', 'deepseek-color'],
  ['openai/', 'openai'],
  ['z-ai/', 'zai'],
  ['moonshotai/', 'moonshot'],
  ['poolside/', 'poolside-color'],
  ['x-ai/', 'xai'],
  ['microsoft/', 'microsoft-color'],
  ['ibm-granite/', 'ibm'],
  ['arcee-ai/', 'arcee-color'],
  ['nousresearch/', 'nousresearch'],
  ['baidu/', 'baidu-color'],
  ['tencent/', 'tencent-color'],
  ['stepfun-ai/', 'stepfun-color'],
  ['dots-studio/', 'dotsstudio'],
  ['allenai/', 'ai2-color'],
  ['bytedance/', 'bytedance-color'],
];

/** A generic icon for a maker without a logo here: a chip. */
const GENERIC =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#71717a" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" ' +
      'height="12" rx="2"/><path d="M9 2v4 M15 2v4 M9 18v4 M15 18v4 M2 9h4 M2 15h4 M18 9h4 M18 15h4"/></svg>',
  );

/** The icon of an OpenRouter model id (without the `openrouter/` prefix). */
export function providerIcon(modelId: string): string {
  const family = FAMILIES.find(([prefix]) => modelId.startsWith(prefix));
  return family ? `providers/${family[1]}.svg` : GENERIC;
}

/**
 * Whether an icon is drawn in `currentColor`: an image cannot take the color of the text, so these
 * are painted with the icon as a mask, and stay readable in the dark theme.
 */
export function isMonochromeIcon(icon: string): boolean {
  return icon.startsWith('providers/') && !icon.endsWith('-color.svg');
}
