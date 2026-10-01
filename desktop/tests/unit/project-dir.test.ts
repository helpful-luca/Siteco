import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isProjectDir, resolveProjectDir } from '../../src/project-dir';

function project(compose = 'name: siteco-docchat\nservices: {}\n'): string {
  const dir = mkdtempSync(join(tmpdir(), 'docchat-project-'));
  writeFileSync(join(dir, 'compose.yaml'), compose);
  return dir;
}

describe('isProjectDir', () => {
  it('needs our compose.yaml', async () => {
    expect(await isProjectDir(project())).toBe(true);
    expect(await isProjectDir(project('name: other\n'))).toBe(false);
    const empty = mkdtempSync(join(tmpdir(), 'docchat-empty-'));
    expect(await isProjectDir(empty)).toBe(false);
    mkdirSync(join(empty, 'compose.yaml'));
    expect(await isProjectDir(empty)).toBe(false);
    expect(await isProjectDir('relative')).toBe(false);
  });
});

describe('resolveProjectDir', () => {
  it('prefers the remembered folder, then the build-time one', async () => {
    const remembered = project();
    const built = project();
    const pick = vi.fn();
    expect(await resolveProjectDir({ remembered, builtIn: built, pick, remember: vi.fn() })).toBe(remembered);
    expect(await resolveProjectDir({ remembered: '/gone', builtIn: built, pick, remember: vi.fn() })).toBe(built);
    expect(pick).not.toHaveBeenCalled();
  });

  it('asks once and remembers a valid choice', async () => {
    const chosen = project();
    const remember = vi.fn();
    const pick = vi.fn(async () => chosen);
    expect(await resolveProjectDir({ builtIn: '/gone', pick, remember })).toBe(chosen);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(remember).toHaveBeenCalledWith(chosen);
  });

  it('returns nothing for a cancelled or wrong choice', async () => {
    const remember = vi.fn();
    expect(await resolveProjectDir({ pick: async () => undefined, remember })).toBeUndefined();
    expect(await resolveProjectDir({ pick: async () => project('name: other\n'), remember })).toBeUndefined();
    expect(remember).not.toHaveBeenCalled();
  });
});
