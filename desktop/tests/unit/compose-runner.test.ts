import { describe, expect, it } from 'vitest';
import {
  composeArgs,
  composeEnv,
  composeFailure,
  composePhase,
  isOurComposeFile,
} from '../../src/compose-runner';

describe('composeArgs', () => {
  it('builds fixed argument arrays with plain, colourless output', () => {
    const base = ['compose', '--file', 'compose.yaml', '--ansi', 'never', '--progress', 'plain'];
    expect(composeArgs('up')).toEqual([...base, 'up', '--detach', '--build']);
    expect(composeArgs('stop')).toEqual([...base, 'stop']);
  });

  it('never carries user input', () => {
    for (const action of ['up', 'stop'] as const) {
      for (const arg of composeArgs(action)) expect(arg).toMatch(/^[a-z.-]+$/);
    }
  });
});

describe('composeEnv', () => {
  const base = { PATH: '/usr/bin:/bin', HOME: '/Users/test', COMPOSE_FILE: 'evil.yaml', COMPOSE_PROJECT_NAME: 'x' };

  it('puts the docker folder and the credential helpers first on PATH', () => {
    const env = composeEnv(base, '/opt/homebrew/bin/docker', 3100);
    const path = env.PATH?.split(':') ?? [];
    expect(path[0]).toBe('/opt/homebrew/bin');
    expect(path).toContain('/Applications/Docker.app/Contents/Resources/bin');
    expect(path).toContain('/usr/bin');
    expect(new Set(path).size).toBe(path.length);
  });

  it('sets the app port and keeps HOME', () => {
    const env = composeEnv(base, '/usr/local/bin/docker', 3100);
    expect(env.APP_PORT).toBe('3100');
    expect(env.HOME).toBe('/Users/test');
  });

  it('drops variables that would point compose at another file or project', () => {
    const env = composeEnv(base, '/usr/local/bin/docker', 3000);
    expect(env.COMPOSE_FILE).toBeUndefined();
    expect(env.COMPOSE_PROJECT_NAME).toBeUndefined();
  });
});

describe('composePhase', () => {
  it('maps plain compose output to a friendly phase', () => {
    expect(composePhase(' clamav Pulling ')).toBe('pulling');
    expect(composePhase(' 4f4fb700ef54 Pull complete ')).toBe('pulling');
    expect(composePhase('#5 [backend 2/9] RUN pip install uv')).toBe('building');
    expect(composePhase(' backend Building')).toBe('building');
    expect(composePhase(' Container siteco-docchat-backend-1  Starting')).toBe('starting');
    expect(composePhase(' Container siteco-docchat-frontend-1  Started')).toBe('starting');
    expect(composePhase(' Network siteco-docchat_default  Creating')).toBe('starting');
    expect(composePhase(' Container siteco-docchat-clamav-1  Running')).toBe('starting');
    expect(composePhase('something else')).toBeUndefined();
  });
});

describe('composeFailure', () => {
  it('recognises a busy port', () => {
    expect(composeFailure(['Error response from daemon: Bind for 127.0.0.1:3000 failed: port is already allocated'])).toBe(
      'port-busy',
    );
    expect(composeFailure(['listen tcp 127.0.0.1:3000: bind: address already in use'])).toBe('port-busy');
  });

  it('falls back to a general failure', () => {
    expect(composeFailure(['failed to solve: process did not complete'])).toBe('compose-failed');
    expect(composeFailure([])).toBe('compose-failed');
  });
});

describe('isOurComposeFile', () => {
  it('accepts only the Siteco Document Chat project', () => {
    expect(isOurComposeFile('name: siteco-docchat\n\nservices:\n')).toBe(true);
    expect(isOurComposeFile('# x\nname: "siteco-docchat"\n')).toBe(true);
    expect(isOurComposeFile('name: something-else\n')).toBe(false);
    expect(isOurComposeFile('services:\n  name: siteco-docchat\n')).toBe(false);
  });
});
