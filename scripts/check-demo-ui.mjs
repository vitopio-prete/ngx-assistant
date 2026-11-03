// Checks that the styled components the demo copied with ng add and the generators are the ones
// of packages/ui: the demo uses them as they were copied, so a change to packages/ui has to reach
// the demo too.
//
// The generators the demo used are the ones whose entry files (schematics/ui/components.json) are
// in apps/demo/src/app/chat. Their files are the entries, every file they import, the icons and
// the theme, as the schematic copies them. Each one must be in the demo with the content it has in
// packages/ui/src/lib, and the demo must have no other file but its index.ts, which the generators
// write.
//
//   node scripts/check-demo-ui.mjs           lists every difference and fails when there is one
//   node scripts/check-demo-ui.mjs --write   copies the files of packages/ui into the demo instead
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(repo, 'packages/ui/src/lib');
const copy = path.join(repo, 'apps/demo/src/app/chat');
const write = process.argv.includes('--write');
const generators = JSON.parse(
  fs.readFileSync(path.join(repo, 'packages/angular/schematics/ui/components.json'), 'utf8'),
);

/** Files as paths relative to a folder, with forward slashes. */
const posix = (file) => file.split(path.sep).join('/');

function listFiles(dir) {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => posix(path.relative(dir, path.join(entry.parentPath, entry.name))));
}

/** The entries and every file of packages/ui they import, as the schematic copies them. */
function closure(entries) {
  const files = new Set(['icons.ts', 'styles/nxa-theme.css']);
  const seen = new Set();
  const pending = [...entries];
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    files.add(file);
    const code = fs.readFileSync(path.join(source, file), 'utf8');
    for (const [, specifier] of code.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
      pending.push(path.posix.join(path.posix.dirname(file), `${specifier}.ts`));
    }
  }
  return files;
}

const present = listFiles(copy).filter((file) => file !== 'index.ts');
const used = Object.entries(generators).filter(([, { entries }]) =>
  entries.every((entry) => present.includes(entry)),
);
const expected = new Set(used.flatMap(([, { entries }]) => [...closure(entries)]));

const problems = [];
for (const file of [...expected].sort()) {
  const from = path.join(source, file);
  const to = path.join(copy, file);
  const content = fs.readFileSync(from);
  if (fs.existsSync(to) && content.equals(fs.readFileSync(to))) continue;
  if (write) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, content);
    console.log(`copied ${file}`);
  } else {
    problems.push(fs.existsSync(to) ? `${file}: differs from packages/ui` : `${file}: missing`);
  }
}
for (const file of present.filter((file) => !expected.has(file))) {
  problems.push(`${file}: no generator copies it any more, delete it`);
}

if (problems.length > 0) {
  console.error(
    `The demo's copies of the styled components are out of date:\n  ${problems.join('\n  ')}\n` +
      'Run "pnpm run sync:demo-ui" for the missing and changed files, and export new ones from ' +
      'apps/demo/src/app/chat/index.ts.',
  );
  process.exit(1);
}
console.log(
  `${expected.size} copied files of ${used.map(([name]) => name).join(', ')} match packages/ui.`,
);
