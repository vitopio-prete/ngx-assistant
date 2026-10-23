import { defineConfig } from 'vitest/config';

// Node environment, worker threads and global test APIs.
export default defineConfig({
  test: {
    environment: 'node',
    pool: 'threads',
    globals: true,
  },
});
