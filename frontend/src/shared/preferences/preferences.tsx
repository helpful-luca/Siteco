'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { fetchJson } from '@/shared/api/client';
import type { PreferencesBody } from '@/shared/api/types';
import { applyLocale } from './apply-locale';
import { applyTheme } from './apply-theme';
import { COOKIE_NAME, COOKIE_ONBOARDED, COOKIE_THEME, type Locale } from './cookies';
import type { InitialPreferences } from './initial';
import { readCookie, writeCookie } from './write-cookie';

const PREFERENCES_KEY = ['preferences'] as const;

const InitialContext = createContext<InitialPreferences | null>(null);

/** Holds what the server rendered with, until the backend's values are loaded. */
export function PreferencesProvider({ initial, children }: { initial: InitialPreferences; children: ReactNode }) {
  return <InitialContext.Provider value={initial}>{children}</InitialContext.Provider>;
}

export function useInitialPreferences(): InitialPreferences {
  const initial = useContext(InitialContext);
  if (!initial) throw new Error('useInitialPreferences needs the PreferencesProvider');
  return initial;
}

const fetchPreferences = () => fetchJson<PreferencesBody>('/api/preferences');

/** The backend's preferences: the truth for browser and desktop window alike. */
export function useStoredPreferences() {
  return useQuery({
    queryKey: PREFERENCES_KEY,
    queryFn: fetchPreferences,
    staleTime: 30_000,
    refetchOnWindowFocus: true, // changed in the other window (annex 10, B17)
  });
}

/** Name and setup state for rendering: the backend's once loaded, the server's before. */
export function usePreferences() {
  const initial = useInitialPreferences();
  const { data } = useStoredPreferences();
  return { name: data?.name ?? initial.name, onboarded: data?.onboarded ?? initial.onboarded, stored: data };
}

/**
 * Writes the render-critical values as cookies so the next server render matches, applies the
 * theme at once and re-renders the server components in a new language. Streams live above the
 * routes and survive the refresh (annex 11, 5.1). Before the setup ran, language and theme stay
 * with what the browser (or the running setup) chose.
 */
function mirrorPreferences(prefs: PreferencesBody, refresh: () => void): void {
  writeCookie(COOKIE_NAME, prefs.name);
  writeCookie(COOKIE_ONBOARDED, prefs.onboarded ? '1' : '0');
  if (!prefs.onboarded) return;
  if (readCookie(COOKIE_THEME) !== prefs.theme) applyTheme(prefs.theme);
  if (document.documentElement.lang !== prefs.locale) {
    applyLocale(prefs.locale as Locale);
    refresh();
  }
}

/** Keeps the cookie mirror in step with the backend. Mounted once inside the app. */
export function PreferencesMirror() {
  const router = useRouter();
  const { data } = useStoredPreferences();
  useEffect(() => {
    if (data) mirrorPreferences(data, router.refresh);
  }, [data, router]);
  return null;
}

/**
 * Saves a change: shown at once, sent as the whole object (annex 11, 3.2), rolled back when
 * the backend refuses it. Resolves with the saved preferences.
 */
export function useSavePreferences() {
  const client = useQueryClient();
  return useCallback(
    async (patch: Partial<PreferencesBody>): Promise<PreferencesBody> => {
      const current = client.getQueryData<PreferencesBody>(PREFERENCES_KEY) ?? (await client.fetchQuery({ queryKey: PREFERENCES_KEY, queryFn: fetchPreferences }));
      const next = { ...current, ...patch };
      client.setQueryData(PREFERENCES_KEY, next);
      try {
        const saved = await fetchJson<PreferencesBody>('/api/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        });
        client.setQueryData(PREFERENCES_KEY, saved);
        return saved;
      } catch (error) {
        client.setQueryData(PREFERENCES_KEY, current);
        throw error;
      }
    },
    [client],
  );
}
