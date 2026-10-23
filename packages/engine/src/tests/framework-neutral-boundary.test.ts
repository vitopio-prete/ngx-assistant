/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SRC_DIR = resolve(__dirname, "..");

// The only packages the engine may import at runtime. Anything else (react,
// react/jsx-runtime, @angular/*, ...) would make the engine framework-bound.
const ALLOWED_PACKAGES = new Set([
  "assistant-stream",
  "assistant-stream/utils",
  "nanoid",
  "nanoid/non-secure",
]);

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?["']([^"']+)["']/g;

const SIDE_EFFECT_IMPORT_RE = /import\s+["']([^"']+)["']/g;

const EXPORT_STAR_RE = /export\s+\*\s+from\s+["']([^"']+)["']/g;

const DYNAMIC_IMPORT_RE = /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;

function resolveRelative(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function collectImports(content: string): string[] {
  const specs: string[] = [];
  for (const re of [
    IMPORT_RE,
    SIDE_EFFECT_IMPORT_RE,
    EXPORT_STAR_RE,
    DYNAMIC_IMPORT_RE,
  ]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      specs.push(match[1]!);
    }
  }
  return specs;
}

function walkFrom(entry: string): { forbidden: string[]; jsxFiles: string[] } {
  const visited = new Set<string>();
  const queue = [entry];
  const forbidden: string[] = [];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    // Comments are dropped first: JSDoc examples such as `import { z } from "zod"`
    // are not imports.
    const content = readFileSync(file, "utf-8")
      .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const specs = collectImports(content);

    for (const spec of specs) {
      if (!spec.startsWith(".") && !ALLOWED_PACKAGES.has(spec)) {
        forbidden.push(`${relative(SRC_DIR, file)} imports "${spec}"`);
        continue;
      }
      const resolved = resolveRelative(file, spec);
      if (resolved && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  const jsxFiles = [...visited]
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => relative(SRC_DIR, file));

  return { forbidden, jsxFiles };
}

describe("framework neutral boundary", () => {
  it("the default entry graph imports only the allowed packages", () => {
    const { forbidden, jsxFiles } = walkFrom(resolve(SRC_DIR, "index.ts"));
    expect(
      forbidden,
      `The default entry must stay loadable with only ${[...ALLOWED_PACKAGES].join(", ")} installed.\n` +
        `These modules in the src/index.ts graph import a forbidden package:\n` +
        forbidden.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
    expect(
      jsxFiles,
      `The JSX transform injects react/jsx-runtime at build time, so the default entry graph must not contain .tsx files:\n` +
        jsxFiles.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });

  it("the internal entry graph imports only the allowed packages", () => {
    const { forbidden, jsxFiles } = walkFrom(resolve(SRC_DIR, "internal.ts"));
    expect(
      forbidden,
      `The internal entry must stay loadable with only ${[...ALLOWED_PACKAGES].join(", ")} installed.\nViolations:\n` +
        forbidden.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
    expect(
      jsxFiles,
      `The JSX transform injects react/jsx-runtime at build time, so the internal entry graph must not contain .tsx files:\n` +
        jsxFiles.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });
});
