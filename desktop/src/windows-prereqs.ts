import { release } from 'node:os';
import { win32 } from 'node:path';
import { runProcess } from './process-runner';

/**
 * Docker Desktop on Windows needs Windows 10 22H2 (build 19045) or Windows 11, WSL 2 and
 * hardware virtualization. When Docker is missing or does not start, the splash names the
 * missing piece instead of a general error.
 */
export const MIN_WINDOWS_BUILD = 19045;

export type WindowsProblem = 'windows-too-old' | 'virtualization-off' | 'wsl-missing';
export type Virtualization = 'on' | 'off' | 'unknown';

export interface WindowsFacts {
  build: number | undefined;
  /** `wsl.exe --status` succeeded. */
  wsl: boolean;
  virtualization: Virtualization;
}

export function windowsBuild(osRelease: string): number | undefined {
  const match = /^\d+\.\d+\.(\d+)/.exec(osRelease);
  return match ? Number(match[1]) : undefined;
}

/** Output of the fixed PowerShell query below: firmware virtualization, then hypervisor present. */
export function parseVirtualization(output: string): Virtualization {
  const answers = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line === 'True' || line === 'False');
  if (answers.length !== 2) return 'unknown';
  return answers.includes('True') ? 'on' : 'off';
}

export function diagnoseWindows(facts: WindowsFacts): WindowsProblem | undefined {
  if (facts.build === undefined) return undefined;
  if (facts.build < MIN_WINDOWS_BUILD) return 'windows-too-old';
  if (facts.virtualization === 'off') return 'virtualization-off';
  if (!facts.wsl) return 'wsl-missing';
  return undefined;
}

/** Fixed query, no user input: both CIM properties, one per line. */
const VIRTUALIZATION_QUERY =
  '(Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled; ' +
  '(Get-CimInstance -ClassName Win32_ComputerSystem).HypervisorPresent';

/** Collects the facts on this Windows machine (about two seconds). */
export async function windowsFacts(env: NodeJS.ProcessEnv = process.env): Promise<WindowsFacts> {
  const system32 = win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32');
  const [wsl, query] = await Promise.all([
    runProcess(win32.join(system32, 'wsl.exe'), ['--status'], { timeoutMs: 15_000 }),
    runProcess(
      win32.join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', VIRTUALIZATION_QUERY],
      { timeoutMs: 15_000 },
    ),
  ]);
  return {
    build: windowsBuild(release()),
    wsl: wsl.ok,
    virtualization: query.ok ? parseVirtualization(query.tail.join('\n')) : 'unknown',
  };
}

export async function diagnoseThisWindows(): Promise<WindowsProblem | undefined> {
  return diagnoseWindows(await windowsFacts());
}
