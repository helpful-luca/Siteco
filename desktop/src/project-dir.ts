import { access, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { isOurComposeFile } from './compose-runner';

export const COMPOSE_FILE = 'compose.yaml';
const MAX_COMPOSE_BYTES = 256 * 1024;
/** Files compose would merge into ours; the app only runs the reviewed compose.yaml. */
const OVERRIDE_FILES = [
  'compose.override.yaml',
  'compose.override.yml',
  'docker-compose.override.yaml',
  'docker-compose.override.yml',
];

export type ProjectCheck = 'ok' | 'invalid' | 'override';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** A folder counts only when its compose.yaml is the Siteco Document Chat project, without overrides. */
export async function checkProjectDir(dir: string | undefined): Promise<ProjectCheck> {
  if (!dir || !isAbsolute(dir)) return 'invalid';
  try {
    const file = join(dir, COMPOSE_FILE);
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_COMPOSE_BYTES) return 'invalid';
    if (!isOurComposeFile(await readFile(file, 'utf8'))) return 'invalid';
  } catch {
    return 'invalid';
  }
  for (const name of OVERRIDE_FILES) {
    if (await exists(join(dir, name))) return 'override';
  }
  return 'ok';
}

export async function isProjectDir(dir: string | undefined): Promise<boolean> {
  return (await checkProjectDir(dir)) === 'ok';
}

/** The first candidate that is a valid project folder (stale or foreign entries are skipped). */
export async function firstProjectDir(candidates: (string | undefined)[]): Promise<string | undefined> {
  for (const dir of candidates) {
    if (await isProjectDir(dir)) return dir;
  }
  return undefined;
}

export interface ProjectSources {
  /** Chosen earlier with the folder picker (config.json). */
  remembered?: string;
  /** The repository root recorded at build time (dist/build-info.json). */
  builtIn?: string;
  pick: () => Promise<string | undefined>;
  remember: (dir: string) => void;
}

export type ProjectResolution = { dir: string } | { error: 'project-missing' | 'project-override' };

/**
 * Remembered folder, then the build-time one, then one folder picker. A folder with an
 * override file is reported as such: it is our project, so asking for another would not help.
 */
export async function resolveProjectDir(sources: ProjectSources): Promise<ProjectResolution> {
  for (const dir of [sources.remembered, sources.builtIn]) {
    const check = await checkProjectDir(dir);
    if (check === 'ok') return { dir: dir! };
    if (check === 'override') return { error: 'project-override' };
  }
  const chosen = await sources.pick();
  const check = await checkProjectDir(chosen);
  if (check === 'override') return { error: 'project-override' };
  if (check !== 'ok') return { error: 'project-missing' };
  sources.remember(chosen!);
  return { dir: chosen! };
}
