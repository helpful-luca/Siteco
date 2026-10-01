import { describe, expect, it } from 'vitest';
import { launchCommand } from '../../src/docker-engine';

describe('launchCommand', () => {
  it('opens Docker.app in the background on a Mac and waits for open to return', () => {
    expect(launchCommand('/Applications/Docker.app', 'darwin')).toEqual({
      file: '/usr/bin/open',
      args: ['-g', '-a', '/Applications/Docker.app'],
      detached: false,
    });
  });

  it('starts Docker Desktop.exe detached on Windows, without arguments', () => {
    const exe = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe';
    expect(launchCommand(exe, 'win32')).toEqual({ file: exe, args: [], detached: true });
  });

  it('has nothing to start elsewhere', () => {
    expect(launchCommand('/opt/docker', 'linux')).toBeUndefined();
  });
});
