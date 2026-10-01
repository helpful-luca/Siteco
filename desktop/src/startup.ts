import { composeFailure, composePhase, type ComposePhase } from './compose-runner';
import type { RunResult } from './process-runner';
import type { ProjectResolution } from './project-dir';
import type { ProbeResult } from './server-probe';

export type StartupError =
  | 'docker-missing'
  | 'docker-not-running'
  | 'project-missing'
  | 'project-override'
  | 'port-busy'
  | 'compose-failed'
  | 'not-responding'
  | 'dev-not-running';

/** What the splash shows. `details` are the last output lines for the Details disclosure. */
export type StartupState =
  | { step: 'checking' }
  | { step: 'docker-starting' }
  | { step: 'compose'; phase: ComposePhase; details: string[] }
  | { step: 'waiting' }
  | { step: 'stopping' }
  | { step: 'ready' }
  | { step: 'error'; error: StartupError; details: string[] };

/** Everything with side effects is injected, so the flow is tested without Docker. */
export interface StartupDeps {
  /** `dev`: backend and next dev run outside Docker (`npm run dev`), the app only waits. */
  mode: 'docker' | 'dev';
  probe: () => Promise<ProbeResult>;
  waitForApp: () => Promise<boolean>;
  locateDocker: () => Promise<string | undefined>;
  dockerRunning: (docker: string) => Promise<boolean>;
  /** Opens Docker Desktop; false when it is not installed as an app. */
  launchDocker: () => Promise<boolean>;
  waitForDocker: (docker: string) => Promise<boolean>;
  /** The compose project folder, asking once with a folder picker when needed. */
  resolveProject: () => Promise<ProjectResolution>;
  composeUp: (docker: string, projectDir: string, onLine: (line: string) => void) => Promise<RunResult>;
  onState: (state: StartupState) => void;
}

const DETAIL_LINES = 12;

/** Brings the app up (Docker, compose, identity check). Resolves true when the window may load it. */
export async function runStartup(deps: StartupDeps): Promise<boolean> {
  const fail = (error: StartupError, details: string[] = []) => {
    deps.onState({ step: 'error', error, details });
    return false;
  };
  const ready = () => {
    deps.onState({ step: 'ready' });
    return true;
  };

  deps.onState({ step: 'checking' });
  if ((await deps.probe()) === 'ours') return ready();

  if (deps.mode === 'dev') {
    deps.onState({ step: 'waiting' });
    return (await deps.waitForApp()) ? ready() : fail('dev-not-running');
  }

  const docker = await deps.locateDocker();
  if (!docker) return fail('docker-missing');

  if (!(await deps.dockerRunning(docker))) {
    deps.onState({ step: 'docker-starting' });
    if (!(await deps.launchDocker())) return fail('docker-not-running');
    if (!(await deps.waitForDocker(docker))) return fail('docker-not-running');
  }

  const project = await deps.resolveProject();
  if ('error' in project) return fail(project.error);
  const projectDir = project.dir;

  let phase: ComposePhase = 'starting';
  const details: string[] = [];
  deps.onState({ step: 'compose', phase, details: [] });
  const result = await deps.composeUp(docker, projectDir, (line) => {
    details.push(line);
    if (details.length > DETAIL_LINES) details.shift();
    phase = composePhase(line) ?? phase;
    deps.onState({ step: 'compose', phase, details: [...details] });
  });
  if (!result.ok) return fail(composeFailure(result.tail), result.tail);

  deps.onState({ step: 'waiting' });
  return (await deps.waitForApp()) ? ready() : fail('not-responding', result.tail);
}
