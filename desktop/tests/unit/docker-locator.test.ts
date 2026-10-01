import { describe, expect, it } from 'vitest';
import { dockerCandidates, locateDocker, locateDockerApp } from '../../src/docker-locator';

const HOME = '/Users/test';

describe('dockerCandidates', () => {
  it('checks the usual install places in a fixed order', () => {
    expect(dockerCandidates(HOME)).toEqual([
      '/usr/local/bin/docker',
      '/opt/homebrew/bin/docker',
      '/Applications/Docker.app/Contents/Resources/bin/docker',
      '/Users/test/Applications/Docker.app/Contents/Resources/bin/docker',
      '/Users/test/.docker/bin/docker',
    ]);
  });
});

describe('locateDocker', () => {
  it('returns the first executable candidate', async () => {
    const found = new Set(['/opt/homebrew/bin/docker', '/Applications/Docker.app/Contents/Resources/bin/docker']);
    const docker = await locateDocker(HOME, async (path) => found.has(path));
    expect(docker).toBe('/opt/homebrew/bin/docker');
  });

  it('prefers /usr/local/bin', async () => {
    expect(await locateDocker(HOME, async () => true)).toBe('/usr/local/bin/docker');
  });

  it('returns undefined when Docker is not installed', async () => {
    expect(await locateDocker(HOME, async () => false)).toBeUndefined();
  });

  it('treats a failing check as not found', async () => {
    const docker = await locateDocker(HOME, async (path) => {
      if (path.startsWith('/usr/local')) throw new Error('EACCES');
      return path.startsWith('/opt/homebrew');
    });
    expect(docker).toBe('/opt/homebrew/bin/docker');
  });
});

describe('locateDockerApp', () => {
  it('finds Docker Desktop in /Applications or ~/Applications', async () => {
    expect(await locateDockerApp(HOME, async (p) => p === '/Applications/Docker.app')).toBe('/Applications/Docker.app');
    expect(await locateDockerApp(HOME, async (p) => p === '/Users/test/Applications/Docker.app')).toBe(
      '/Users/test/Applications/Docker.app',
    );
    expect(await locateDockerApp(HOME, async () => false)).toBeUndefined();
  });
});
