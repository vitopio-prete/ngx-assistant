/**
 * Minimal typing for `process` in the library build: only `process.env.NODE_ENV`
 * is read, so no Node typings are pulled into the library build. Applications
 * may replace it at build time (`define`); the build of dist guards each read
 * for apps that do not (scripts/guard-node-env.mjs).
 */
declare const process: { env: Record<string, string | undefined> };
