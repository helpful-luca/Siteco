import { describe, expect, it } from 'vitest';
import { resolveLocale, resolveTheme } from '@/shared/preferences/cookies';

describe('resolveLocale', () => {
  it('prefers a valid cookie', () => expect(resolveLocale('en', 'de-DE')).toBe('en'));
  it('ignores an invalid cookie and uses Accept-Language', () =>
    expect(resolveLocale('fr', 'fr-FR,en-US;q=0.9')).toBe('en'));
  it('falls back to German', () => expect(resolveLocale(undefined, 'fr-FR')).toBe('de'));
  it('handles a missing header', () => expect(resolveLocale()).toBe('de'));
});

describe('resolveTheme', () => {
  it('accepts known values', () => expect(resolveTheme('dark')).toBe('dark'));
  it('defaults to system for unknown values', () => expect(resolveTheme('<x>')).toBe('system'));
});
