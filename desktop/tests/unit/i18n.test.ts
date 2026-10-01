import { describe, expect, it } from 'vitest';
import { MESSAGES, pickLang } from '../../src/i18n';
import type { StartupError } from '../../src/startup';

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(strings);
}

describe('messages', () => {
  it('has the same keys in German and English', () => {
    expect(keys(MESSAGES.de).sort()).toEqual(keys(MESSAGES.en).sort());
  });

  it('uses no en dash or em dash', () => {
    for (const text of [...strings(MESSAGES.de), ...strings(MESSAGES.en)]) {
      expect(text).not.toMatch(/[–—]/);
    }
  });

  it('addresses the reader with "du" in German', () => {
    for (const text of strings(MESSAGES.de)) expect(text).not.toMatch(/\b(Sie|Ihre?n?)\b/);
  });

  it('covers every startup error', () => {
    const errors: StartupError[] = [
      'docker-missing',
      'docker-not-running',
      'project-missing',
      'project-override',
      'port-busy',
      'compose-failed',
      'not-responding',
      'dev-not-running',
    ];
    for (const error of errors) expect(MESSAGES.de.splash.errors[error].title).toBeTruthy();
  });
});

describe('pickLang', () => {
  it('follows the first preferred system language', () => {
    expect(pickLang(['de-DE', 'en-US'])).toBe('de');
    expect(pickLang(['de'])).toBe('de');
    expect(pickLang(['en-GB', 'de-DE'])).toBe('en');
    expect(pickLang(['fr-FR'])).toBe('en');
    expect(pickLang([])).toBe('en');
  });
});
