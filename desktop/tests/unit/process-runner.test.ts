import { describe, expect, it } from 'vitest';
import { runProcess } from '../../src/process-runner';

const node = process.execPath;

describe('runProcess', () => {
  it('streams lines from stdout and stderr and reports success', async () => {
    const lines: string[] = [];
    const result = await runProcess(
      node,
      ['-e', 'console.log("one\\ntwo"); console.error("three")'],
      { timeoutMs: 10_000 },
      (line) => lines.push(line),
    );
    expect(result.ok).toBe(true);
    expect(lines).toEqual(expect.arrayContaining(['one', 'two', 'three']));
    expect(result.tail).toEqual(expect.arrayContaining(['one', 'two', 'three']));
  });

  it('reports a non-zero exit', async () => {
    const result = await runProcess(node, ['-e', 'console.error("boom"); process.exit(3)'], { timeoutMs: 10_000 });
    expect(result.ok).toBe(false);
    expect(result.tail).toContain('boom');
  });

  it('stops a process that runs too long', async () => {
    const started = Date.now();
    const result = await runProcess(node, ['-e', 'setTimeout(() => {}, 60_000)'], { timeoutMs: 300 });
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('reports a missing binary instead of throwing', async () => {
    const result = await runProcess('/nonexistent/docker', ['info'], { timeoutMs: 1_000 });
    expect(result.ok).toBe(false);
  });

  it('keeps only the last lines, without colour codes, cut to a sane length', async () => {
    const script = 'for (let i = 0; i < 50; i++) console.log("\\u001b[32mline " + i + "\\u001b[0m"); console.log("x".repeat(500))';
    const result = await runProcess(node, ['-e', script], { timeoutMs: 10_000 });
    expect(result.tail).toHaveLength(12);
    expect(result.tail).toContain('line 49');
    expect(result.tail.at(-1)?.length).toBeLessThanOrEqual(200);
    expect(result.tail.join('')).not.toContain('\u001b');
  });
});
