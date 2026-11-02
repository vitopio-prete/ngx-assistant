import { posix } from 'node:path';

/** An import of Tailwind CSS, whole (`tailwindcss`) or in parts (`tailwindcss/theme.css`). */
const tailwindImport = /^@import\s+['"]tailwindcss(?:\/[^'"]*)?['"][^;]*;[^\S\r\n]*(?:\r?\n)?/gm;

const eolOf = (css: string): string => (css.includes('\r\n') ? '\r\n' : '\n');

export function hasTailwindImport(css: string): boolean {
  return new RegExp(tailwindImport.source, 'm').test(css);
}

/** Puts `@import 'tailwindcss';` at the top of a stylesheet that does not import it yet. */
export function addTailwindImport(css: string): string {
  if (hasTailwindImport(css)) return css;
  const charset = /^@charset\s[^;]*;\s*(?:\r?\n)?/.exec(css)?.[0] ?? '';
  return `${charset}@import 'tailwindcss';${eolOf(css)}${css.slice(charset.length)}`;
}

/** The specifier that imports `target` from `stylesheet`, both workspace paths. */
export function relativeImport(stylesheet: string, target: string): string {
  const path = posix.relative(posix.dirname(stylesheet), target);
  return path.startsWith('.') ? path : `./${path}`;
}

/** Whether the stylesheet imports `specifier`, with or without `./` and `url(...)`. */
function importsSpecifier(css: string, specifier: string): boolean {
  const bare = specifier.replace(/^\.\//, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`@import\\s+(?:url\\(\\s*)?['"]?(?:\\./)?${bare}['"]?`).test(css);
}

/**
 * Imports `specifier` right after the (last) Tailwind import, or after the leading imports when
 * there is none. Returns the stylesheet unchanged when it already imports it.
 */
export function addImportAfterTailwind(css: string, specifier: string): string {
  if (importsSpecifier(css, specifier)) return css;
  const eol = eolOf(css);
  const line = `@import '${specifier}';${eol}`;
  const tailwind = [...css.matchAll(tailwindImport)].at(-1);
  if (tailwind) {
    const end = tailwind.index + tailwind[0].length;
    const separator = tailwind[0].endsWith('\n') ? '' : eol;
    return css.slice(0, end) + separator + line + css.slice(end);
  }
  const leading = /^(?:\s*@(?:charset|import)\s[^;]*;[^\S\r\n]*(?:\r?\n)?)*/.exec(css)?.[0] ?? '';
  const separator = leading === '' || leading.endsWith('\n') ? '' : eol;
  return leading + separator + line + css.slice(leading.length);
}
