import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { appUrl, DEFAULT_PORT, loadConfig, parseConfig, saveConfig } from '../../src/config';

describe('parseConfig', () => {
  it('falls back to the defaults for anything that is not an object', () => {
    expect(parseConfig(null)).toEqual({ port: DEFAULT_PORT });
    expect(parseConfig('x')).toEqual({ port: DEFAULT_PORT });
    expect(parseConfig([1])).toEqual({ port: DEFAULT_PORT });
  });

  it('keeps valid fields', () => {
    const raw = {
      projectDir: '/Users/x/Siteco',
      port: 3100,
      window: { x: 10, y: 20, width: 1200, height: 800, maximized: true },
    };
    expect(parseConfig(raw)).toEqual(raw);
  });

  it('drops invalid fields one by one', () => {
    expect(parseConfig({ port: 80 })).toEqual({ port: DEFAULT_PORT });
    expect(parseConfig({ port: 3000.5 })).toEqual({ port: DEFAULT_PORT });
    expect(parseConfig({ port: '3100' })).toEqual({ port: DEFAULT_PORT });
    expect(parseConfig({ projectDir: 'relative/path' })).toEqual({ port: DEFAULT_PORT });
    expect(parseConfig({ projectDir: 42 })).toEqual({ port: DEFAULT_PORT });
    expect(parseConfig({ window: { width: 'big', height: 800 } })).toEqual({ port: DEFAULT_PORT });
    expect(parseConfig({ window: { width: 10, height: 10 } })).toEqual({ port: DEFAULT_PORT });
  });

  it('accepts a window without a position', () => {
    expect(parseConfig({ window: { width: 1000, height: 700 } })).toEqual({
      port: DEFAULT_PORT,
      window: { width: 1000, height: 700 },
    });
  });
});

describe('loadConfig and saveConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docchat-config-'));
  });

  it('returns the defaults when the file is missing or corrupt', () => {
    expect(loadConfig(join(dir, 'missing.json'))).toEqual({ port: DEFAULT_PORT });
    const file = join(dir, 'config.json');
    writeFileSync(file, '{not json');
    expect(loadConfig(file)).toEqual({ port: DEFAULT_PORT });
  });

  it('round-trips and writes the file for the owner only', () => {
    const file = join(dir, 'nested', 'config.json');
    const config = { port: 3100, projectDir: '/tmp/project', window: { width: 1360, height: 880 } };
    saveConfig(file, config);
    expect(loadConfig(file)).toEqual(config);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(config);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});

describe('appUrl', () => {
  it('always points at localhost', () => {
    expect(appUrl(3000)).toBe('http://localhost:3000');
    expect(appUrl(3100)).toBe('http://localhost:3100');
  });
});
