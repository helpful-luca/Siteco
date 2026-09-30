import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { BACKEND_URL, internalHeaders } from '@/shared/api/backend';
import type { PreferencesBody } from '@/shared/api/types';
import { COOKIE_LOCALE, COOKIE_NAME, COOKIE_ONBOARDED, COOKIE_THEME } from './cookies';
import { type InitialPreferences, resolveInitialPreferences } from './initial';

const BACKEND_TIMEOUT_MS = 1500;

async function storedPreferences(): Promise<PreferencesBody | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/preferences`, {
      headers: { Accept: 'application/json', ...internalHeaders() },
      cache: 'no-store',
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    return res.ok ? ((await res.json()) as PreferencesBody) : null;
  } catch {
    return null; // starting or not running: render with the browser's defaults
  }
}

/** Once per request, shared by the root layout and next-intl's request config. */
export const getInitialPreferences = cache(async (): Promise<InitialPreferences> => {
  const jar = await cookies();
  const values = {
    locale: jar.get(COOKIE_LOCALE)?.value,
    theme: jar.get(COOKIE_THEME)?.value,
    name: jar.get(COOKIE_NAME)?.value,
    onboarded: jar.get(COOKIE_ONBOARDED)?.value,
  };
  const acceptLanguage = (await headers()).get('accept-language') ?? undefined;
  const stored = values.onboarded === undefined ? await storedPreferences() : null;
  return resolveInitialPreferences(values, acceptLanguage, stored);
});
