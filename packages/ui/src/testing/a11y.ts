import axe from 'axe-core';

/**
 * The axe violations under `root`, as `rule: html` lines. jsdom renders no layout, so contrast is
 * checked by hand in the preview.
 */
export async function axeViolations(root: Element) {
  const result = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return result.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(' | ')}`,
  );
}
