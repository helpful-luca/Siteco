import { describe, expect, it } from 'vitest';
import type { PreferencesBody } from '@/shared/api/types';
import { resolveInitialPreferences } from './initial';

const STORED: PreferencesBody = {
  locale: 'en',
  theme: 'dark',
  name: 'Luca',
  default_model: 'claude-sonnet-5-5',
  effort: 'low',
  style: 'concise',
  compare_models: ['claude-sonnet-5-5', 'claude-haiku-4-5'],
  onboarded: true,
  retention_days: 0,
};

describe('resolveInitialPreferences', () => {
  it('renders from the cookie mirror when it is there', () => {
    const initial = resolveInitialPreferences(
      { locale: 'en', theme: 'light', name: 'Anna', onboarded: '1' },
      'de-DE',
      null,
    );
    expect(initial).toEqual({ locale: 'en', theme: 'light', name: 'Anna', onboarded: true, mirrored: true });
  });

  it('falls back per value on broken cookies', () => {
    const initial = resolveInitialPreferences({ locale: 'fr', theme: 'pink', name: '%E0%A4%A', onboarded: '0' }, 'en-US', null);
    expect(initial).toMatchObject({ locale: 'en', theme: 'system', name: '', onboarded: false });
  });

  it('uses the backend once when the cookies are missing (new browser, desktop window)', () => {
    const initial = resolveInitialPreferences({}, 'de-DE', STORED);
    expect(initial).toEqual({ locale: 'en', theme: 'dark', name: 'Luca', onboarded: true, mirrored: false });
  });

  it('keeps the browser language and system theme before the setup ran', () => {
    const initial = resolveInitialPreferences({ locale: 'en' }, 'de-DE', { ...STORED, onboarded: false, name: '' });
    expect(initial).toEqual({ locale: 'en', theme: 'system', name: '', onboarded: false, mirrored: false });
  });

  it('does not open the setup while the backend cannot be asked', () => {
    const initial = resolveInitialPreferences({}, 'en-GB', null);
    expect(initial).toMatchObject({ locale: 'en', theme: 'system', onboarded: true, mirrored: false });
  });
});
