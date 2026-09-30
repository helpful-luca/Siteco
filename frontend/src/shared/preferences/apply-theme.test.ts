import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme } from '@/shared/preferences/apply-theme';

function mockSystemDark(dark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: dark && query.includes('dark'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.className = '';
  document.cookie = 'theme=; max-age=0; path=/';
});

describe('applyTheme', () => {
  it('sets the dark class and cookie for dark', () => {
    mockSystemDark(false);
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.cookie).toContain('theme=dark');
  });

  it('removes the dark class for light even if the system is dark', () => {
    mockSystemDark(true);
    document.documentElement.classList.add('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('follows the system for system', () => {
    mockSystemDark(true);
    applyTheme('system');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.cookie).toContain('theme=system');
  });
});
