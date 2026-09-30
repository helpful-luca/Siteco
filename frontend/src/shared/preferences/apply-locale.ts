import { COOKIE_LOCALE, type Locale } from '@/shared/preferences/cookies';

const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** Remembers the locale; the caller refreshes the router so server components re-render in it. */
export function applyLocale(locale: Locale): void {
  document.cookie = `${COOKIE_LOCALE}=${locale}; max-age=${ONE_YEAR_S}; path=/; samesite=lax`;
  document.documentElement.lang = locale;
}
