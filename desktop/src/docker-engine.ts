import { spawn } from 'node:child_process';
import { composeEnv } from './compose-runner';
import { pollUntil } from './poll';
import { runProcess } from './process-runner';

/** Docker Desktop needs about 20 to 60 seconds after the start; two minutes covers a slow machine. */
export const DOCKER_START_TIMEOUT_MS = 120_000;

/** True when the engine answers (`docker info`), not just when the CLI exists. */
export async function dockerRunning(docker: string, port: number): Promise<boolean> {
  const result = await runProcess(docker, ['info', '--format', '{{.ServerVersion}}'], {
    env: composeEnv(process.env, docker, port),
    timeoutMs: 15_000,
  });
  return result.ok;
}

export interface LaunchCommand {
  file: string;
  args: string[];
  /** Windows: Docker Desktop.exe keeps running, so it is started on its own and not awaited. */
  detached: boolean;
}

/** How to start Docker Desktop: `open -g -a Docker.app` on a Mac, `Docker Desktop.exe` on Windows. */
export function launchCommand(dockerApp: string, platform: NodeJS.Platform = process.platform): LaunchCommand | undefined {
  if (platform === 'darwin') return { file: '/usr/bin/open', args: ['-g', '-a', dockerApp], detached: false };
  if (platform === 'win32') return { file: dockerApp, args: [], detached: true };
  return undefined;
}

/** Starts Docker Desktop in the background; false when it is not installed or did not start. */
export async function launchDockerApp(dockerApp: string | undefined): Promise<boolean> {
  const command = dockerApp ? launchCommand(dockerApp) : undefined;
  if (!command) return false;
  if (!command.detached) return (await runProcess(command.file, command.args, { timeoutMs: 15_000 })).ok;
  return new Promise((resolve) => {
    const child = spawn(command.file, command.args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', () => resolve(false));
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
  });
}

export function waitForDocker(docker: string, port: number, signal?: AbortSignal): Promise<boolean> {
  return pollUntil(() => dockerRunning(docker, port), {
    timeoutMs: DOCKER_START_TIMEOUT_MS,
    intervalMs: 2_000,
    signal,
  });
}
