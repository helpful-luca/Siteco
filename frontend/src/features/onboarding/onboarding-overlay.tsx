'use client';

import { Dialog } from '@base-ui/react/dialog';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { applyLocale } from '@/shared/preferences/apply-locale';
import { applyTheme } from '@/shared/preferences/apply-theme';
import { OnboardingFlow, type OnboardingResult } from './onboarding-flow';

export type OnboardingOutcome =
  | { kind: 'finished'; result: OnboardingResult }
  /** Skip button, Escape: language and theme as they were applied while choosing. */
  | { kind: 'skipped'; current: Omit<OnboardingResult, 'name'> };

type Props = {
  open: boolean;
  initial: OnboardingResult;
  onDone: (outcome: OnboardingOutcome) => void;
};

/** Full-window setup over the app, on the canvas with its light pool. Language and theme apply while choosing. */
export function OnboardingOverlay({ open, initial, onDone }: Props) {
  const router = useRouter();
  const t = useTranslations('onboarding');
  const live = useRef({ locale: initial.locale, theme: initial.theme });
  useEffect(() => {
    if (open) live.current = { locale: initial.locale, theme: initial.theme };
  }, [open, initial.locale, initial.theme]);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => !next && onDone({ kind: 'skipped', current: { ...live.current } })}
    >
      <Dialog.Portal>
        {/* The setup owns the whole window like Apple's setup assistant: the app appears behind it on finish. */}
        <Dialog.Backdrop className="setup-canvas fixed inset-0 transition-opacity duration-500 ease-out-soft data-starting-style:opacity-0 data-ending-style:opacity-0" />
        <Dialog.Popup
          aria-label={t('language.title')}
          className="fixed inset-0 flex outline-none transition-[opacity,scale] duration-500 ease-out-soft data-starting-style:scale-[0.99] data-starting-style:opacity-0 data-ending-style:scale-[1.01] data-ending-style:opacity-0"
        >
          <OnboardingFlow
            initial={initial}
            onLocaleChange={(locale) => {
              live.current.locale = locale;
              applyLocale(locale);
              router.refresh();
            }}
            onThemeChange={(theme) => {
              live.current.theme = theme;
              applyTheme(theme);
            }}
            onFinish={(result) => onDone({ kind: 'finished', result })}
            onSkip={(current) => onDone({ kind: 'skipped', current })}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
