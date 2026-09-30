'use client';

import { useLocale } from 'next-intl';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from '@/shared/preferences/cookies';
import { useInitialPreferences, usePreferences, useSavePreferences } from '@/shared/preferences/preferences';
import { type OnboardingOutcome, OnboardingOverlay } from './onboarding-overlay';

type Onboarding = { open: () => void };

const Context = createContext<Onboarding | null>(null);

/**
 * Shows the setup over the app on the first start (`onboarded` false) and again on request from
 * the settings. Finishing and skipping both save `onboarded`, so it never nags (annex 10, B1);
 * closing the window halfway saves nothing and the setup comes back (B2).
 */
export function OnboardingHost({ children }: { children: ReactNode }) {
  const locale = useLocale() as Locale;
  const initial = useInitialPreferences();
  const { onboarded, name, stored } = usePreferences();
  const save = useSavePreferences();
  // A fresh flow (first step) each time it is opened again.
  const [session, setSession] = useState(0);
  const [rerun, setRerun] = useState(false);
  const [done, setDone] = useState(false);
  // Deleting everything with a reset brings the setup back, also later in this session.
  if (onboarded && done) setDone(false);
  const open = rerun || (!onboarded && !done);

  const finish = (outcome: OnboardingOutcome) => {
    setDone(true);
    setRerun(false);
    const changes = outcome.kind === 'finished' ? outcome.result : outcome.current;
    // A failed save only means the setup shows again next time.
    save({ ...changes, onboarded: true }).catch(() => undefined);
  };

  const start = useCallback(() => {
    setSession((n) => n + 1);
    setRerun(true);
  }, []);
  const value = useMemo(() => ({ open: start }), [start]);

  return (
    <Context.Provider value={value}>
      {children}
      <OnboardingOverlay
        key={session}
        open={open}
        initial={{ locale, theme: stored?.onboarded ? stored.theme : initial.theme, name }}
        onDone={finish}
      />
    </Context.Provider>
  );
}

export function useOnboarding(): Onboarding {
  const value = useContext(Context);
  if (!value) throw new Error('useOnboarding needs the OnboardingHost');
  return value;
}
