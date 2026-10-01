import { composeEnv } from './compose-runner';
import { runProcess } from './process-runner';
import { pollUntil } from './poll';

/** Docker Desktop needs about 20 to 60 seconds after `open`; two minutes covers a slow Mac. */
export const DOCKER_START_TIMEOUT_MS = 120_000;

/** True when the engine answers (`docker info`), not just when the CLI exists. */
export async function dockerRunning(docker: string, port: number): Promise<boolean> {
  const result = await runProcess(docker, ['info', '--format', '{{.ServerVersion}}'], {
    env: composeEnv(process.env, docker, port),
    timeoutMs: 15_000,
  });
  return result.ok;
}

/** Starts Docker Desktop in the background (`open -g -a <Docker.app>`). */
export async function launchDockerApp(dockerApp: string | undefined): Promise<boolean> {
  if (!dockerApp) return false;
  const result = await runProcess('/usr/bin/open', ['-g', '-a', dockerApp], { timeoutMs: 15_000 });
  return result.ok;
}

export function waitForDocker(docker: string, port: number, signal?: AbortSignal): Promise<boolean> {
  return pollUntil(() => dockerRunning(docker, port), {
    timeoutMs: DOCKER_START_TIMEOUT_MS,
    intervalMs: 2_000,
    signal,
  });
}
