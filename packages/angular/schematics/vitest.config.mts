import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// The schematics run in Node, on the build in dist/angular/schematics (pnpm run build:schematics).
export default defineConfig({
  cacheDir: join(import.meta.dirname, '../../../node_modules/.vite/schematics'),
  test: {
    root: import.meta.dirname,
    environment: 'node',
    include: ['**/*.spec.ts'],
    testTimeout: 30_000,
  },
});
