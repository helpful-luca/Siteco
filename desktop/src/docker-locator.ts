import { access, constants } from 'node:fs/promises';
import { posix, win32 } from 'node:path';

export type PathCheck = (path: string) => Promise<boolean>;
type Env = Record<string, string | undefined>;

const unique = (paths: string[]) => paths.filter((path, index) => paths.indexOf(path) === index);

/** Docker Desktop's install folder on Windows: Program Files (also when it is on another drive). */
function windowsDockerDirs(home: string, env: Env): string[] {
  return unique([
    win32.join(env.ProgramFiles ?? 'C:\\Program Files', 'Docker', 'Docker'),
    'C:\\Program Files\\Docker\\Docker',
    win32.join(env.LOCALAPPDATA ?? win32.join(home, 'AppData', 'Local'), 'Programs', 'Docker', 'Docker'),
  ]);
}

/**
 * Where the docker CLI lives. An app opened from the Finder or the Start menu does not get the
 * shell's PATH, so the CLI is looked up by absolute path, never via PATH.
 */
export function dockerCandidates(home: string, platform: NodeJS.Platform = process.platform, env: Env = process.env): string[] {
  if (platform === 'win32') {
    return unique([
      ...windowsDockerDirs(home, env).map((dir) => win32.join(dir, 'resources', 'bin', 'docker.exe')),
      'C:\\ProgramData\\DockerDesktop\\version-bin\\docker.exe',
    ]);
  }
  return [
    '/usr/local/bin/docker',
    '/opt/homebrew/bin/docker',
    '/Applications/Docker.app/Contents/Resources/bin/docker',
    posix.join(home, 'Applications/Docker.app/Contents/Resources/bin/docker'),
    posix.join(home, '.docker/bin/docker'),
  ];
}

/** Docker Desktop itself (Docker.app or Docker Desktop.exe), needed to start the engine. */
export function dockerAppCandidates(home: string, platform: NodeJS.Platform = process.platform, env: Env = process.env): string[] {
  if (platform === 'win32') return windowsDockerDirs(home, env).map((dir) => win32.join(dir, 'Docker Desktop.exe'));
  return ['/Applications/Docker.app', posix.join(home, 'Applications/Docker.app')];
}

export const isExecutable: PathCheck = async (path) => {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const exists: PathCheck = async (path) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

async function firstMatch(paths: string[], check: PathCheck): Promise<string | undefined> {
  for (const path of paths) {
    const ok = await check(path).catch(() => false);
    if (ok) return path;
  }
  return undefined;
}

export function locateDocker(
  home: string,
  check: PathCheck = isExecutable,
  platform: NodeJS.Platform = process.platform,
  env: Env = process.env,
): Promise<string | undefined> {
  return firstMatch(dockerCandidates(home, platform, env), check);
}

export function locateDockerApp(
  home: string,
  check: PathCheck = exists,
  platform: NodeJS.Platform = process.platform,
  env: Env = process.env,
): Promise<string | undefined> {
  return firstMatch(dockerAppCandidates(home, platform, env), check);
}
