import { posix, win32 } from 'node:path';
import { runProcess, type RunResult } from './process-runner';

export type ComposeAction = 'up' | 'stop';
export type ComposePhase = 'pulling' | 'building' | 'starting';
export type ComposeFailure = 'port-busy' | 'compose-failed';

/** Credential helpers (docker-credential-desktop) live next to the CLI in Docker Desktop. */
const DOCKER_DESKTOP_BIN = '/Applications/Docker.app/Contents/Resources/bin';
const SYSTEM_PATH = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];

/** First start: images are built or pulled (minutes). Later starts only start containers. */
export const COMPOSE_UP_TIMEOUT_MS = 30 * 60_000;
export const COMPOSE_STOP_TIMEOUT_MS = 2 * 60_000;

/**
 * Fixed argument arrays; nothing in them comes from the user or the environment. The explicit
 * `--file` ignores COMPOSE_FILE (also from .env) and override files. `--build` keeps the
 * containers on the code in the project folder; with an unchanged checkout the build cache
 * answers in seconds.
 */
export function composeArgs(action: ComposeAction): string[] {
  const base = ['compose', '--file', 'compose.yaml', '--ansi', 'never', '--progress', 'plain'];
  return action === 'up' ? [...base, 'up', '--detach', '--build'] : [...base, 'stop'];
}

/**
 * Environment for docker compose. An app started from the Finder or the Start menu has a
 * minimal PATH, so the docker folder (and on a Mac Docker Desktop's helpers) goes first.
 * Variables that would make compose read another file or project are dropped; APP_PORT carries
 * the configured port. Windows spells it `Path` and separates with `;`: exactly one key stays.
 */
export function composeEnv(
  base: NodeJS.ProcessEnv,
  docker: string,
  port: number,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const { COMPOSE_FILE: _file, COMPOSE_PROJECT_NAME: _project, COMPOSE_PROFILES: _profiles, ...rest } = base;
  const windows = platform === 'win32';
  const pathKeys = Object.keys(rest).filter((key) => key.toUpperCase() === 'PATH');
  const inherited = pathKeys.map((key) => rest[key] ?? '').join(windows ? ';' : ':');
  for (const key of pathKeys) delete rest[key];
  const front = windows ? [win32.dirname(docker)] : [posix.dirname(docker), DOCKER_DESKTOP_BIN, ...SYSTEM_PATH];
  const path = [...front, ...inherited.split(windows ? ';' : ':')].filter(
    (entry, index, all) => entry !== '' && all.indexOf(entry) === index,
  );
  return { ...rest, [windows ? 'Path' : 'PATH']: path.join(windows ? ';' : ':'), APP_PORT: String(port) };
}

/** Friendly phase for one line of `--progress plain` output, if the line says anything. */
export function composePhase(line: string): ComposePhase | undefined {
  if (/^#\d+ /.test(line) || /\bBuild(ing|ed)?\b/.test(line)) return 'building';
  if (/\bPull(ing|ed)?\b|\bPull complete\b|\bDownload(ing)?\b|\bExtracting\b/.test(line)) return 'pulling';
  if (/\b(Creat|Recreat|Start|Wait)(ing|ed)\b|\bRunning\b|\bHealthy\b/.test(line)) return 'starting';
  return undefined;
}

export function composeFailure(tail: string[]): ComposeFailure {
  const text = tail.join('\n');
  const busy = /port is already allocated|address already in use|ports are not available|only one usage of each socket address/i;
  return busy.test(text) ? 'port-busy' : 'compose-failed';
}

/** The compose file must be ours (top-level `name: siteco-docchat`) before the app runs it. */
export function isOurComposeFile(content: string): boolean {
  return /^name:\s*["']?siteco-docchat["']?\s*$/m.test(content);
}

export function runCompose(
  docker: string,
  action: ComposeAction,
  options: { projectDir: string; port: number; env?: NodeJS.ProcessEnv },
  onLine?: (line: string) => void,
): Promise<RunResult> {
  return runProcess(
    docker,
    composeArgs(action),
    {
      cwd: options.projectDir,
      env: composeEnv(options.env ?? process.env, docker, options.port),
      timeoutMs: action === 'up' ? COMPOSE_UP_TIMEOUT_MS : COMPOSE_STOP_TIMEOUT_MS,
    },
    onLine,
  );
}
