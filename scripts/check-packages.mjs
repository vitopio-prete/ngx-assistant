// Packs @ngx-assistant/engine and @ngx-assistant/angular as npm would publish them and checks the
// tarballs: their files, their package.json, publint and are-the-types-wrong. Run it after
// `pnpm run build`.
//
//   node scripts/check-packages.mjs [folder]
//
// The tarballs stay in folder/engine and folder/angular (default: a new temporary folder), so that
// the release workflow publishes the very files it checked.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unguardedReads } from '../packages/engine/scripts/guard-node-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'nxa-packages-'));
mkdirSync(out, { recursive: true });

const run = (command, args, cwd = root) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const bin = (name) => join(root, 'node_modules/.bin', name);

const packages = [
  // pnpm pack resolves the workspace: ranges; the engine has none, but stays on the same tool.
  { name: '@ngx-assistant/engine', dir: 'packages/engine', pack: ['pnpm', ['pack']] },
  // ng-packagr writes the package to publish into dist/angular.
  { name: '@ngx-assistant/angular', dir: 'dist/angular', pack: ['npm', ['pack', '--silent']] },
];

const failures = [];
const fail = (pkg, message) => failures.push(`${pkg.name}: ${message}`);

/** The files of a tarball, without the leading `package/`. */
function filesOf(tarball) {
  return run('tar', ['-tzf', tarball])
    .split('\n')
    .filter((line) => line && !line.endsWith('/'))
    .map((line) => line.replace(/^package\//, ''));
}

const readFromTarball = (tarball, file) => run('tar', ['-xzOf', tarball, `package/${file}`]);

const forbidden = [
  [/(^|\/)tests?\//, 'test folder'],
  [/\.(test|spec)\.[cm]?[jt]sx?$/, 'test file'],
  [/(^|\/)testing\//, 'test helper'],
  [/\.tsbuildinfo$/, 'TypeScript build info'],
  [/(^|\/)(node_modules|\.angular|coverage)\//, 'build or install folder'],
  [/(^|\/)(tsconfig[^/]*|vitest\.config\.[cm]?ts|ng-package\.json|\.npmrc)$/, 'build config'],
  [/^scripts\//, 'build script'],
];

const tarballs = {};
for (const pkg of packages) {
  const dest = join(out, pkg.name.split('/')[1]);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest);
  const [command, args] = pkg.pack;
  run(command, [...args, '--pack-destination', dest], join(root, pkg.dir));
  const [tarball] = readdirSync(dest).filter((file) => file.endsWith('.tgz'));
  const target = join(dest, tarball);
  tarballs[pkg.name] = target;

  const files = filesOf(target);
  for (const required of ['package.json', 'README.md', 'LICENSE', 'NOTICE']) {
    if (!files.includes(required)) fail(pkg, `${required} is missing`);
  }
  for (const file of files) {
    for (const [pattern, what] of forbidden) {
      if (pattern.test(file)) fail(pkg, `${file} is a ${what} and should not be published`);
    }
  }
  // Every source map points at sources that are published too.
  for (const map of files.filter((file) => file.endsWith('.js.map'))) {
    const { sources = [] } = JSON.parse(readFromTarball(target, map));
    for (const source of sources) {
      const resolved = join(dirname(map), source).split('\\').join('/');
      if (!files.includes(resolved))
        fail(pkg, `${map} points at ${resolved}, which is not published`);
    }
  }

  const manifest = JSON.parse(readFromTarball(target, 'package.json'));
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (/^[a-z]+:/.test(range))
        fail(pkg, `${field}.${name} is ${range}, a range npm cannot install`);
    }
  }
  if (manifest.private) fail(pkg, 'package.json is private');
  if (manifest.publishConfig?.access !== 'public') fail(pkg, 'publishConfig.access is not public');
  pkg.manifest = manifest;
  pkg.files = files;

  console.log(`${pkg.name}@${manifest.version}: ${files.length} files`);
  const show = { cwd: root, stdio: 'inherit' };
  execFileSync(bin('publint'), ['run', target, '--strict'], show);
  // Both packages are ES modules only, as Angular libraries are: CommonJS resolution is not checked.
  execFileSync(bin('attw'), [target, '--profile', 'esm-only', '--format', 'table-flipped'], show);
}

// The engine must load in a browser app that does not define process.env.NODE_ENV.
const [engine, angular] = packages;
for (const file of engine.files.filter((file) => file.endsWith('.js'))) {
  if (unguardedReads(readFromTarball(tarballs[engine.name], file)) > 0) {
    fail(engine, `${file} reads process.env.NODE_ENV without a fallback`);
  }
}

// ng add installs the engine at the range the library declares, so it must accept the engine of
// the same release. Versions are linked: the range is ^ on the current version.
const peer = angular.manifest.peerDependencies?.[engine.name];
if (peer !== `^${engine.manifest.version}`) {
  fail(angular, `peerDependencies.${engine.name} is ${peer}, expected ^${engine.manifest.version}`);
}
if (angular.manifest.version !== engine.manifest.version) {
  fail(
    angular,
    `version ${angular.manifest.version} differs from the engine's ${engine.manifest.version}`,
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s) in the packages:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`The packages are ready to publish (tarballs in ${out}).`);
