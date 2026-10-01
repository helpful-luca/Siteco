import { describe, expect, it, vi } from 'vitest';
import { runStartup, type StartupDeps, type StartupState } from '../../src/startup';

function deps(overrides: Partial<StartupDeps> = {}): StartupDeps & { states: StartupState[] } {
  const states: StartupState[] = [];
  return {
    states,
    mode: 'docker',
    probe: vi.fn(async () => 'down' as const),
    waitForApp: vi.fn(async () => true),
    locateDocker: vi.fn(async () => '/usr/local/bin/docker'),
    dockerRunning: vi.fn(async () => true),
    launchDocker: vi.fn(async () => true),
    waitForDocker: vi.fn(async () => true),
    resolveProject: vi.fn(async () => ({ dir: '/Users/test/Siteco' })),
    composeUp: vi.fn(async () => ({ ok: true, timedOut: false, tail: [] })),
    onState: (state) => states.push(state),
    ...overrides,
  };
}

const steps = (states: StartupState[]) => states.map((s) => s.step);

describe('runStartup', () => {
  it('opens at once when the app already answers', async () => {
    const d = deps({ probe: vi.fn(async () => 'ours' as const) });
    expect(await runStartup(d)).toBe(true);
    expect(d.locateDocker).not.toHaveBeenCalled();
    expect(d.composeUp).not.toHaveBeenCalled();
    expect(steps(d.states)).toEqual(['checking', 'ready']);
  });

  it('runs compose when Docker is up but the app is not', async () => {
    const d = deps();
    expect(await runStartup(d)).toBe(true);
    expect(d.launchDocker).not.toHaveBeenCalled();
    expect(d.composeUp).toHaveBeenCalledWith('/usr/local/bin/docker', '/Users/test/Siteco', expect.any(Function));
    expect(steps(d.states)).toEqual(['checking', 'compose', 'waiting', 'ready']);
  });

  it('starts Docker Desktop first when the engine is not running', async () => {
    const d = deps({ dockerRunning: vi.fn(async () => false) });
    expect(await runStartup(d)).toBe(true);
    expect(d.launchDocker).toHaveBeenCalled();
    expect(steps(d.states)).toEqual(['checking', 'docker-starting', 'compose', 'waiting', 'ready']);
  });

  it('streams friendly compose phases and keeps the last lines for Details', async () => {
    const d = deps({
      composeUp: vi.fn(async (_docker, _dir, onLine) => {
        onLine('#1 [backend internal] load build definition');
        onLine(' Container siteco-docchat-backend-1  Started');
        return { ok: true, timedOut: false, tail: [] };
      }),
    });
    await runStartup(d);
    const compose = d.states.filter((s) => s.step === 'compose');
    expect(compose.map((s) => s.step === 'compose' && s.phase)).toEqual(['starting', 'building', 'starting']);
    expect(compose.at(-1)).toMatchObject({ details: ['#1 [backend internal] load build definition', ' Container siteco-docchat-backend-1  Started'] });
  });

  it('reports a missing docker CLI', async () => {
    const d = deps({ locateDocker: vi.fn(async () => undefined) });
    expect(await runStartup(d)).toBe(false);
    expect(d.states.at(-1)).toMatchObject({ step: 'error', error: 'docker-missing' });
  });

  it('reports Docker that does not come up', async () => {
    const d = deps({ dockerRunning: vi.fn(async () => false), waitForDocker: vi.fn(async () => false) });
    expect(await runStartup(d)).toBe(false);
    expect(d.states.at(-1)).toMatchObject({ step: 'error', error: 'docker-not-running' });
  });

  it('reports Docker that cannot be launched', async () => {
    const d = deps({ dockerRunning: vi.fn(async () => false), launchDocker: vi.fn(async () => false) });
    expect(await runStartup(d)).toBe(false);
    expect(d.waitForDocker).not.toHaveBeenCalled();
    expect(d.states.at(-1)).toMatchObject({ step: 'error', error: 'docker-not-running' });
  });

  it('reports a missing project folder', async () => {
    const d = deps({ resolveProject: vi.fn(async () => ({ error: 'project-missing' as const })) });
    expect(await runStartup(d)).toBe(false);
    expect(d.composeUp).not.toHaveBeenCalled();
    expect(d.states.at(-1)).toMatchObject({ step: 'error', error: 'project-missing' });

    const override = deps({ resolveProject: vi.fn(async () => ({ error: 'project-override' as const })) });
    expect(await runStartup(override)).toBe(false);
    expect(override.states.at(-1)).toMatchObject({ step: 'error', error: 'project-override' });
  });

  it('reports a busy port and a general compose failure with the last lines', async () => {
    const busy = deps({
      composeUp: vi.fn(async () => ({ ok: false, timedOut: false, tail: ['Bind for 127.0.0.1:3000 failed: port is already allocated'] })),
    });
    expect(await runStartup(busy)).toBe(false);
    expect(busy.states.at(-1)).toMatchObject({ step: 'error', error: 'port-busy' });

    const failed = deps({ composeUp: vi.fn(async () => ({ ok: false, timedOut: false, tail: ['failed to solve'] })) });
    expect(await runStartup(failed)).toBe(false);
    expect(failed.states.at(-1)).toEqual({ step: 'error', error: 'compose-failed', details: ['failed to solve'] });
  });

  it('reports an app that does not answer after compose', async () => {
    const d = deps({ waitForApp: vi.fn(async () => false) });
    expect(await runStartup(d)).toBe(false);
    expect(d.states.at(-1)).toMatchObject({ step: 'error', error: 'not-responding' });
  });

  it('only waits in dev mode, without Docker', async () => {
    const d = deps({ mode: 'dev' });
    expect(await runStartup(d)).toBe(true);
    expect(d.locateDocker).not.toHaveBeenCalled();
    expect(d.composeUp).not.toHaveBeenCalled();
    expect(steps(d.states)).toEqual(['checking', 'waiting', 'ready']);

    const down = deps({ mode: 'dev', waitForApp: vi.fn(async () => false) });
    expect(await runStartup(down)).toBe(false);
    expect(down.states.at(-1)).toMatchObject({ step: 'error', error: 'dev-not-running' });
  });
});
