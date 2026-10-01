import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';

export type PathCheck = (path: string) => Promise<boolean>;

/**
 * Where the docker CLI lives on a Mac. An app opened from the Finder gets a minimal PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin), so the CLI is looked up by absolute path, never via PATH.
 */
export function dockerCandidates(home: string): string[] {
  return [
    '/usr/local/bin/docker',
    '/opt/homebrew/bin/docker',
    '/Applications/Docker.app/Contents/Resources/bin/docker',
    join(home, 'Applications/Docker.app/Contents/Resources/bin/docker'),
    join(home, '.docker/bin/docker'),
  ];
}

export function dockerAppCandidates(home: string): string[] {
  return ['/Applications/Docker.app', join(home, 'Applications/Docker.app')];
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

export function locateDocker(home: string, check: PathCheck = isExecutable): Promise<string | undefined> {
  return firstMatch(dockerCandidates(home), check);
}

/** Docker Desktop's bundle, needed to start the engine with `open -a`. */
export function locateDockerApp(home: string, check: PathCheck = exists): Promise<string | undefined> {
  return firstMatch(dockerAppCandidates(home), check);
}
