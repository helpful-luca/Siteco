import { describe, expect, it } from 'vitest';
import { dockerAppCandidates, dockerCandidates, locateDocker, locateDockerApp } from '../../src/docker-locator';

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

describe('on Windows', () => {
  const ENV = { ProgramFiles: 'D:\\Programme', LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local' };

  it('looks for docker.exe in Docker Desktop resources, Program Files first', () => {
    expect(dockerCandidates('C:\\Users\\test', 'win32', ENV)).toEqual([
      'D:\\Programme\\Docker\\Docker\\resources\\bin\\docker.exe',
      'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
      'C:\\Users\\test\\AppData\\Local\\Programs\\Docker\\Docker\\resources\\bin\\docker.exe',
      'C:\\ProgramData\\DockerDesktop\\version-bin\\docker.exe',
    ]);
  });

  it('falls back to the default folder without ProgramFiles and drops duplicates', () => {
    const paths = dockerCandidates('C:\\Users\\test', 'win32', {});
    expect(paths[0]).toBe('C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe');
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths.every((path) => path.endsWith('docker.exe'))).toBe(true);
  });

  it('finds Docker Desktop.exe to start the engine', async () => {
    const app = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';
    expect(dockerAppCandidates('C:\\Users\\test', 'win32', {})).toContain(app);
    expect(await locateDockerApp('C:\\Users\\test', async (p) => p === app, 'win32', {})).toBe(app);
  });
});
