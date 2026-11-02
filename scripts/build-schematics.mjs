// Builds the schematics of @ngx-assistant/angular into dist/angular/schematics: compiles them,
// copies their JSON files and bundles the styled components of packages/ui/src/lib, which the
// generators copy into the app. Run it after `ng build @ngx-assistant/angular`, which empties
// dist/angular.

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'packages/angular/schematics');
const uiLib = join(root, 'packages/ui/src/lib');
const out = join(root, 'dist/angular/schematics');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const toPosix = (path) => path.split(sep).join('/');

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => toPosix(relative(dir, join(entry.parentPath, entry.name))))
    .sort();
}

/** The files of packages/ui/src/lib that are copied: everything but the tests and the barrel. */
export function copiedUiFiles() {
  return listFiles(uiLib).filter((file) => !file.endsWith('.spec.ts') && file !== 'index.ts');
}

const importPattern = /(?:from|import)\s+['"]([^'"]+)['"]/g;

function importsOf(file) {
  if (!existsSync(join(uiLib, file))) {
    throw new Error(
      `packages/ui/src/lib/${file} is imported but does not exist (imports name .ts files without extension)`,
    );
  }
  const text = readFileSync(join(uiLib, file), 'utf8');
  return [...text.matchAll(importPattern)].map((match) => match[1]);
}

/** The package that a bare import specifier belongs to (`@angular/cdk/menu` → `@angular/cdk`). */
function packageOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * The files a generator copies: its entries and every file they import, transitively, plus the
 * icons and the theme, which all components use. Throws when a file imports something that is
 * not copied (the test helpers, for instance).
 */
export function closureOf(entries) {
  const files = new Set(['styles/nxa-theme.css']);
  const packages = new Set();
  const queue = [...entries, 'icons.ts'];
  while (queue.length > 0) {
    const file = queue.shift();
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of importsOf(file)) {
      if (!specifier.startsWith('.')) {
        packages.add(packageOf(specifier));
        continue;
      }
      const target = posix.normalize(posix.join(posix.dirname(file), specifier)) + '.ts';
      if (target.startsWith('..') || target.startsWith('testing/')) {
        throw new Error(`${file} imports ${specifier}, which is not copied into the app`);
      }
      queue.push(target);
    }
  }
  return { files: [...files].sort(), packages: [...packages].sort() };
}

/** The packages the app needs for the copied files, with the ranges packages/ui uses. */
function dependenciesOf(packages, uiPackage) {
  // Provided by Angular itself or by ng add.
  const provided = new Set(['@angular/core', '@angular/common', '@ngx-assistant/angular']);
  // The theme imports the overlay stylesheet of the CDK.
  const needed = new Set([...packages.filter((name) => !provided.has(name)), '@angular/cdk']);
  const dependencies = {};
  for (const name of [...needed].sort()) {
    if (name === '@ngx-assistant/engine') continue; // ng add installs it at the library's range.
    const range = uiPackage.dependencies?.[name];
    if (!range) throw new Error(`packages/ui/package.json does not list ${name}`);
    dependencies[name] = range;
  }
  return dependencies;
}

/** The order of the exports in packages/ui/src/lib/index.ts, as module specifiers. */
function exportOrder() {
  const text = readFileSync(join(uiLib, 'index.ts'), 'utf8');
  return [...text.matchAll(/export \* from '\.\/([^']+)'/g)].map((match) => `${match[1]}.ts`);
}

export function buildManifest() {
  const components = readJson(join(source, 'ui/components.json'));
  const uiPackage = readJson(join(root, 'packages/ui/package.json'));
  const angularPackage = readJson(join(root, 'packages/angular/package.json'));
  const order = exportOrder();

  const generators = {};
  const covered = new Set();
  for (const [name, { entries }] of Object.entries(components)) {
    const { files, packages } = closureOf(entries);
    files.forEach((file) => covered.add(file));
    generators[name] = {
      files,
      exports: order.filter((file) => files.includes(file)),
      dependencies: dependenciesOf(packages, uiPackage),
    };
  }

  const missing = copiedUiFiles().filter((file) => !covered.has(file));
  if (missing.length > 0) {
    throw new Error(
      `No generator in packages/angular/schematics/ui/components.json copies ${missing.join(', ')}`,
    );
  }
  return {
    versions: {
      '@ngx-assistant/engine': angularPackage.peerDependencies['@ngx-assistant/engine'],
      tailwindcss: uiPackage.dependencies.tailwindcss,
      '@tailwindcss/postcss': uiPackage.dependencies['@tailwindcss/postcss'],
    },
    generators,
  };
}

function build() {
  rmSync(out, { recursive: true, force: true });

  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  execFileSync(process.execPath, [tsc, '-p', join(source, 'tsconfig.json')], { stdio: 'inherit' });

  for (const file of listFiles(source).filter((file) => file.endsWith('.json'))) {
    if (file.startsWith('tsconfig') || file === 'ui/components.json') continue;
    mkdirSync(dirname(join(out, file)), { recursive: true });
    cpSync(join(source, file), join(out, file));
  }
  // dist/angular/package.json is an ES module package; the schematics are CommonJS.
  writeFileSync(join(out, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');

  const manifest = buildManifest();
  writeFileSync(join(out, 'ui/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  // `.template` keeps TypeScript and editors from reading the copies as sources of the package.
  for (const file of copiedUiFiles()) {
    const target = join(out, 'ui/files', `${file}.template`);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(uiLib, file), target);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) build();
