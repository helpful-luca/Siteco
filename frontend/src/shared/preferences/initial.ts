import type { PreferencesBody } from '@/shared/api/types';
import { type Locale, parseName, parseOnboarded, resolveLocale, resolveTheme, type Theme } from './cookies';

/** The preferences the server renders the first HTML with, so nothing flashes. */
export type InitialPreferences = {
  locale: Locale;
  theme: Theme;
  name: string;
  onboarded: boolean;
  /** False when the cookies were missing: the client writes them once. */
  mirrored: boolean;
};

export type CookieValues = { locale?: string; theme?: string; name?: string; onboarded?: string };

/**
 * Cookies first (the mirror of the backend). Without them (first start of a new browser or the
 * desktop window) the backend's stored values, once. Before the setup ran, and when the backend
 * cannot be reached, the browser's language and the system theme.
 */
export function resolveInitialPreferences(
  cookies: CookieValues,
  acceptLanguage: string | undefined,
  stored: PreferencesBody | null,
): InitialPreferences {
  const onboarded = parseOnboarded(cookies.onboarded);
  if (onboarded !== undefined) {
    return {
      locale: resolveLocale(cookies.locale, acceptLanguage),
      theme: resolveTheme(cookies.theme),
      name: parseName(cookies.name),
      onboarded,
      mirrored: true,
    };
  }
  if (stored?.onboarded) {
    return { locale: stored.locale, theme: stored.theme, name: stored.name, onboarded: true, mirrored: false };
  }
  return {
    locale: resolveLocale(cookies.locale, acceptLanguage),
    theme: resolveTheme(cookies.theme),
    name: stored?.name ?? '',
    // Unknown while the backend is away: the client asks again and opens the setup if needed.
    onboarded: stored === null,
    mirrored: false,
  };
}
