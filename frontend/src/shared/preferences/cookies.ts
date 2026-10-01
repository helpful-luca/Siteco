/** Render-critical preferences mirrored as cookies so the server renders without a flash. */

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
const DEFAULT_LOCALE: Locale = 'de';

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const COOKIE_LOCALE = 'locale';
export const COOKIE_THEME = 'theme';
export const COOKIE_NAME = 'name';
export const COOKIE_ONBOARDED = 'onboarded';

export const NAME_MAX_CODE_POINTS = 40;
// Longest cookie value we read for the name: 40 code points, percent-encoded, with some room.
const NAME_COOKIE_MAX = 512;
// C0 and C1 controls, zero width space, bidi marks, overrides and isolates, the BOM.
// Zero width (non-)joiners stay: emoji sequences and some scripts need them.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g;

const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);
const isTheme = (value: unknown): value is Theme => THEMES.includes(value as Theme);

export function resolveLocale(cookie?: string, acceptLanguage?: string): Locale {
  if (isLocale(cookie)) return cookie;
  const preferred = (acceptLanguage ?? '')
    .split(',')
    .map((part) => part.trim().slice(0, 2).toLowerCase())
    .find(isLocale);
  return preferred ?? DEFAULT_LOCALE;
}

export function resolveTheme(cookie?: string): Theme {
  return isTheme(cookie) ? cookie : 'system';
}

/**
 * The name is only ever shown back as React text. Still: invisible and bidi characters out,
 * whitespace collapsed, at most 40 code points (the backend's limit) without cutting a grapheme.
 */
export function sanitizeName(raw: string): string {
  const name = raw.normalize('NFC').replace(INVISIBLE, '').split(/\s+/).filter(Boolean).join(' ');
  let result = '';
  let count = 0;
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name)) {
    const size = [...segment].length;
    if (count + size > NAME_MAX_CODE_POINTS) break;
    result += segment;
    count += size;
  }
  return result.trimEnd();
}

/** Allowlist parsers for the cookie mirror: anything odd reads as empty. */
export function parseName(cookie?: string): string {
  if (!cookie || cookie.length > NAME_COOKIE_MAX) return '';
  try {
    return sanitizeName(decodeURIComponent(cookie));
  } catch {
    return '';
  }
}

export function parseOnboarded(cookie?: string): boolean | undefined {
  if (cookie === '1') return true;
  if (cookie === '0') return false;
  return undefined;
}
