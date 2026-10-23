/**
 * Minimal typing for `process` in the library build: only `process.env.NODE_ENV`
 * is read, and applications replace it at build time (`define`), so no Node
 * typings are pulled into the library build.
 */
declare const process: { env: Record<string, string | undefined> };
