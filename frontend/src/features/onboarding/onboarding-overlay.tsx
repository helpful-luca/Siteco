'use client';

import { Dialog } from '@base-ui/react/dialog';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { applyLocale } from '@/shared/preferences/apply-locale';
import { applyTheme } from '@/shared/preferences/apply-theme';
import { OnboardingFlow, type OnboardingResult } from './onboarding-flow';

type Props = {
  open: boolean;
  initial: OnboardingResult;
  onDone: (result: OnboardingResult | null) => void;
};

/** Full-window setup layer above the dimmed app. Language and theme apply while choosing. */
export function OnboardingOverlay({ open, initial, onDone }: Props) {
  const router = useRouter();
  const t = useTranslations('onboarding');
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onDone(null)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 bg-black/25 backdrop-blur-md transition-opacity duration-300 data-starting-style:opacity-0 data-ending-style:opacity-0 dark:bg-black/55" />
        <Dialog.Popup
          aria-label={t('language.title')}
          className="fixed inset-0 grid place-items-center p-4 outline-none transition-[opacity,scale] duration-300 ease-out-soft data-starting-style:scale-[0.98] data-starting-style:opacity-0 data-ending-style:opacity-0"
        >
          <OnboardingFlow
            initial={initial}
            onLocaleChange={(locale) => {
              applyLocale(locale);
              router.refresh();
            }}
            onThemeChange={applyTheme}
            onFinish={(result) => onDone(result)}
            onSkip={() => onDone(null)}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
