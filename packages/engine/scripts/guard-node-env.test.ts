import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain ES module without typings.
import { guardNodeEnv, unguardedReads } from './guard-node-env.mjs';

const check = 'process.env.NODE_ENV !== "production" ? "checks on" : "checks off"';

describe('guardNodeEnv', () => {
  it('falls back to production when process is not defined', () => {
    expect(() => runInNewContext(check)).toThrow(/process is not defined/);
    expect(runInNewContext(guardNodeEnv(check))).toBe('checks off');
  });

  it('falls back to production when process has no env', () => {
    expect(runInNewContext(guardNodeEnv(check), { process: {} })).toBe('checks off');
  });

  it('reads NODE_ENV when process is defined', () => {
    const env = (NODE_ENV: string) => ({ process: { env: { NODE_ENV } } });
    expect(runInNewContext(guardNodeEnv(check), env('development'))).toBe('checks on');
    expect(runInNewContext(guardNodeEnv(check), env('production'))).toBe('checks off');
  });

  it('keeps the read replaceable by a define of the application build', () => {
    // A define replaces the member expression process.env.NODE_ENV wherever it appears.
    const defined = guardNodeEnv(check).replaceAll('process.env.NODE_ENV', '"development"');
    expect(runInNewContext(defined)).toBe('checks on');
  });

  it('leaves other names alone', () => {
    const code = 'globalThis.process.env.NODE_ENV; process.env.NODE_ENV_X; $process.env.NODE_ENV';
    expect(unguardedReads(code)).toBe(0);
    expect(guardNodeEnv(code)).toBe(code);
  });

  it('guards every read once', () => {
    const code = `${check};\nif (process.env.NODE_ENV === "production") {}`;
    expect(unguardedReads(code)).toBe(2);
    const guarded = guardNodeEnv(code);
    expect(unguardedReads(guarded)).toBe(0);
    expect(guardNodeEnv(guarded)).toBe(guarded);
  });
});
