import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { checkProjectDir, firstProjectDir, isProjectDir, resolveProjectDir } from '../../src/project-dir';

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

describe('checkProjectDir', () => {
  it('refuses a folder with a compose override file', async () => {
    for (const name of ['compose.override.yaml', 'compose.override.yml', 'docker-compose.override.yml']) {
      const dir = project();
      writeFileSync(join(dir, name), 'services: {}\n');
      expect(await checkProjectDir(dir)).toBe('override');
      expect(await isProjectDir(dir)).toBe(false);
    }
    expect(await checkProjectDir(project())).toBe('ok');
    expect(await checkProjectDir('/gone')).toBe('invalid');
  });
});

describe('firstProjectDir', () => {
  it('skips stale and invalid candidates', async () => {
    const valid = project();
    expect(await firstProjectDir(['/gone', undefined, project('name: other\n'), valid])).toBe(valid);
    expect(await firstProjectDir(['/gone', undefined])).toBeUndefined();
  });
});

describe('resolveProjectDir', () => {
  it('prefers the remembered folder, then the build-time one', async () => {
    const remembered = project();
    const built = project();
    const pick = vi.fn();
    expect(await resolveProjectDir({ remembered, builtIn: built, pick, remember: vi.fn() })).toEqual({ dir: remembered });
    expect(await resolveProjectDir({ remembered: '/gone', builtIn: built, pick, remember: vi.fn() })).toEqual({ dir: built });
    expect(pick).not.toHaveBeenCalled();
  });

  it('asks once and remembers a valid choice', async () => {
    const chosen = project();
    const remember = vi.fn();
    const pick = vi.fn(async () => chosen);
    expect(await resolveProjectDir({ builtIn: '/gone', pick, remember })).toEqual({ dir: chosen });
    expect(pick).toHaveBeenCalledTimes(1);
    expect(remember).toHaveBeenCalledWith(chosen);
  });

  it('reports a cancelled or wrong choice as missing', async () => {
    const remember = vi.fn();
    expect(await resolveProjectDir({ pick: async () => undefined, remember })).toEqual({ error: 'project-missing' });
    expect(await resolveProjectDir({ pick: async () => project('name: other\n'), remember })).toEqual({
      error: 'project-missing',
    });
    expect(remember).not.toHaveBeenCalled();
  });

  it('reports an override file instead of asking for another folder', async () => {
    const dir = project();
    writeFileSync(join(dir, 'compose.override.yaml'), 'services: {}\n');
    const pick = vi.fn();
    expect(await resolveProjectDir({ remembered: dir, pick, remember: vi.fn() })).toEqual({ error: 'project-override' });
    expect(pick).not.toHaveBeenCalled();
  });
});
