// Runs after the build of the engine. The engine reads process.env.NODE_ENV for its development
// checks and expects the application's bundler to replace it (`define`). An application that does
// not would throw `ReferenceError: process is not defined` in the browser, so every read in dist
// becomes an expression that falls back to "production" when `process` is missing. A bundler that
// defines process.env.NODE_ENV still replaces the read inside it.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Not a property of something else (globalThis.process...), not a longer name (NODE_ENV_X).
const read = /(?<![\w$.])process\.env\.NODE_ENV(?![\w$])/g;

export const guardedRead =
  '(() => { try { return process.env.NODE_ENV; } catch { return "production"; } })()';

/** Replaces every read of process.env.NODE_ENV in `code` that is not guarded yet. */
export function guardNodeEnv(code) {
  return code
    .split(guardedRead)
    .map((part) => part.replace(read, guardedRead))
    .join(guardedRead);
}

/** The reads of process.env.NODE_ENV in `code` that are not guarded. */
export function unguardedReads(code) {
  return code.split(guardedRead).join('').match(read)?.length ?? 0;
}

function guardDir(dir) {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const path = join(entry.parentPath, entry.name);
    const code = readFileSync(path, 'utf8');
    const reads = unguardedReads(code);
    if (reads === 0) continue;
    count += reads;
    writeFileSync(path, guardNodeEnv(code));
  }
  return count;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  console.log(`Guarded ${guardDir(dist)} reads of process.env.NODE_ENV in dist`);
}
