import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { isOurComposeFile } from './compose-runner';

const COMPOSE_FILE = 'compose.yaml';
const MAX_COMPOSE_BYTES = 256 * 1024;

/** A folder counts only when its compose.yaml is the Siteco Document Chat project. */
export async function isProjectDir(dir: string | undefined): Promise<boolean> {
  if (!dir || !isAbsolute(dir)) return false;
  try {
    const file = join(dir, COMPOSE_FILE);
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_COMPOSE_BYTES) return false;
    return isOurComposeFile(await readFile(file, 'utf8'));
  } catch {
    return false;
  }
}

export interface ProjectSources {
  /** Chosen earlier with the folder picker (config.json). */
  remembered?: string;
  /** The repository root recorded at build time (dist/build-info.json). */
  builtIn?: string;
  pick: () => Promise<string | undefined>;
  remember: (dir: string) => void;
}

export async function resolveProjectDir(sources: ProjectSources): Promise<string | undefined> {
  for (const dir of [sources.remembered, sources.builtIn]) {
    if (await isProjectDir(dir)) return dir;
  }
  const chosen = await sources.pick();
  if (!(await isProjectDir(chosen))) return undefined;
  sources.remember(chosen!);
  return chosen;
}
