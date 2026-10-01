import { execFile } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface RunResult {
  ok: boolean;
  timedOut: boolean;
  /** The last lines of output (stdout and stderr), without colour codes; for the Details view. */
  tail: string[];
}

const TAIL_LINES = 12;
const MAX_LINE = 200;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function clean(line: string): string {
  return line.replace(ANSI, '').replace(/\s+$/, '').slice(0, MAX_LINE);
}

/**
 * Runs a binary with a fixed argument array: `execFile`, no shell, so nothing is ever parsed
 * as a command line. Output is streamed line by line; the promise never rejects.
 */
export function runProcess(
  file: string,
  args: readonly string[],
  options: RunOptions,
  onLine: (line: string) => void = () => {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const tail: string[] = [];
    let timedOut = false;

    const push = (line: string) => {
      const text = clean(line);
      if (!text.trim()) return;
      tail.push(text);
      if (tail.length > TAIL_LINES) tail.shift();
      onLine(text);
    };

    const child = execFile(
      file,
      [...args],
      { cwd: options.cwd, env: options.env, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error) => {
        clearTimeout(timer);
        flush();
        resolve({ ok: !error && !timedOut, timedOut, tail });
      },
    );

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);

    const buffers = { stdout: '', stderr: '' };
    const feed = (key: keyof typeof buffers) => (chunk: Buffer | string) => {
      buffers[key] += chunk.toString();
      const parts = buffers[key].split(/\r?\n|\r/);
      buffers[key] = parts.pop() ?? '';
      parts.forEach(push);
    };
    const flush = () => {
      for (const key of ['stdout', 'stderr'] as const) {
        if (buffers[key]) push(buffers[key]);
        buffers[key] = '';
      }
    };
    child.stdout?.on('data', feed('stdout'));
    child.stderr?.on('data', feed('stderr'));
  });
}
