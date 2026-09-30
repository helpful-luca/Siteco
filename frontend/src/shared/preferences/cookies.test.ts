import { describe, expect, it } from 'vitest';
import { parseName, parseOnboarded, resolveLocale, resolveTheme, sanitizeName } from '@/shared/preferences/cookies';

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

describe('sanitizeName', () => {
  it('trims, removes control, zero width and bidi characters', () => {
    expect(sanitizeName('  Luca\u0000\u200b ')).toBe('Luca');
    expect(sanitizeName('Anna\u202eMaria')).toBe('AnnaMaria');
    expect(sanitizeName('Jean  \t Luc')).toBe('Jean Luc');
  });

  it('caps at 40 code points without cutting a grapheme', () => {
    expect(sanitizeName('x'.repeat(60))).toHaveLength(40);
    const family = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}'; // one grapheme, five code points
    const name = sanitizeName('a'.repeat(38) + family);
    expect(name).toBe('a'.repeat(38));
    expect([...sanitizeName('a'.repeat(30) + family)].length).toBe(35);
  });

  it('keeps markup as plain text (React renders it escaped)', () => {
    expect(sanitizeName('<b>Luca</b>')).toBe('<b>Luca</b>');
  });
});

describe('cookie parsers', () => {
  it('reads a percent-encoded name and cleans it', () => {
    expect(parseName(encodeURIComponent(' Zoë\u202e '))).toBe('Zoë');
  });

  it('ignores broken encodings and oversized values', () => {
    expect(parseName('%E0%A4%A')).toBe('');
    expect(parseName('x'.repeat(10_000))).toBe('');
    expect(parseName(undefined)).toBe('');
  });

  it('knows only 1 and 0 for onboarded', () => {
    expect(parseOnboarded('1')).toBe(true);
    expect(parseOnboarded('0')).toBe(false);
    expect(parseOnboarded('yes')).toBeUndefined();
    expect(parseOnboarded(undefined)).toBeUndefined();
  });
});
