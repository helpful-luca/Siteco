/** Render-critical preferences mirrored as cookies so the server renders without a flash. */

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'de';

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const COOKIE_LOCALE = 'locale';
export const COOKIE_THEME = 'theme';

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
