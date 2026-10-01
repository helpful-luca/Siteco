import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSplashAction, SPLASH_CHANNELS } from '../../src/splash-ipc';

describe('splash IPC', () => {
  it('accepts only the known actions', () => {
    expect(isSplashAction('retry')).toBe(true);
    expect(isSplashAction('quit')).toBe(true);
    expect(isSplashAction('open-shell')).toBe(false);
    expect(isSplashAction(undefined)).toBe(false);
  });

  it('uses the same channel names in the sandboxed preload', () => {
    const preload = readFileSync(join(__dirname, '../../src/splash-preload.ts'), 'utf8');
    for (const channel of Object.values(SPLASH_CHANNELS)) expect(preload).toContain(`'${channel}'`);
  });

  it('keeps both preloads free of local imports (sandboxed preloads cannot load them)', () => {
    for (const file of ['preload.ts', 'splash-preload.ts']) {
      const source = readFileSync(join(__dirname, '../../src', file), 'utf8');
      expect(source).not.toMatch(/from '\.\.?\//);
    }
  });
});
