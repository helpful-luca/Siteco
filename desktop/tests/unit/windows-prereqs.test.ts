import { describe, expect, it } from 'vitest';
import {
  diagnoseWindows,
  MIN_WINDOWS_BUILD,
  parseVirtualization,
  windowsBuild,
} from '../../src/windows-prereqs';

describe('windowsBuild', () => {
  it('reads the build number from os.release()', () => {
    expect(windowsBuild('10.0.19045')).toBe(19045);
    expect(windowsBuild('10.0.26100')).toBe(26100);
    expect(windowsBuild('garbage')).toBeUndefined();
  });

  it('accepts Windows 10 22H2 as the oldest build', () => {
    expect(MIN_WINDOWS_BUILD).toBe(19045);
  });
});

describe('parseVirtualization', () => {
  it('is on when a hypervisor runs or the firmware allows it', () => {
    expect(parseVirtualization('False\r\nTrue\r\n')).toBe('on');
    expect(parseVirtualization('True\nFalse\n')).toBe('on');
  });

  it('is off only when both say no', () => {
    expect(parseVirtualization('False\nFalse\n')).toBe('off');
  });

  it('is unknown when the answer is missing or odd', () => {
    expect(parseVirtualization('')).toBe('unknown');
    expect(parseVirtualization('Zugriff verweigert')).toBe('unknown');
  });
});

describe('diagnoseWindows', () => {
  const ok = { build: 22631, wsl: true, virtualization: 'on' as const };

  it('finds nothing on a ready Windows 10 or 11', () => {
    expect(diagnoseWindows(ok)).toBeUndefined();
    expect(diagnoseWindows({ ...ok, build: 19045 })).toBeUndefined();
    expect(diagnoseWindows({ ...ok, virtualization: 'unknown' })).toBeUndefined();
  });

  it('names the first missing requirement in a fixed order', () => {
    expect(diagnoseWindows({ build: 19044, wsl: false, virtualization: 'off' })).toBe('windows-too-old');
    expect(diagnoseWindows({ ...ok, wsl: false, virtualization: 'off' })).toBe('virtualization-off');
    expect(diagnoseWindows({ ...ok, wsl: false })).toBe('wsl-missing');
  });

  it('does not guess when the build is unknown', () => {
    expect(diagnoseWindows({ ...ok, build: undefined })).toBeUndefined();
  });
});
