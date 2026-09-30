'use client';

import { useTranslations } from 'next-intl';
import type { Theme } from '@/shared/preferences/cookies';
import { TooltipProvider } from '@/shared/ui';
import { AppPreview } from './app-preview';
import { ComponentSheet } from './component-sheet';
import { ThemeSwitcher } from './theme-switcher';

export function StyleguideView({ theme, startOnboarding }: { theme: Theme; startOnboarding: boolean }) {
  const t = useTranslations('styleguide');
  return (
    <TooltipProvider>
      <div className="h-dvh min-h-[640px]">
        <AppPreview />
      </div>
      <div className="border-t border-hairline">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-end justify-between gap-6 px-6 pt-16">
          <div>
            <h1 className="text-title-1 font-semibold">{t('title')}</h1>
            <p className="mt-2 max-w-[60ch] text-ink-muted">{t('intro')}</p>
          </div>
          <ThemeSwitcher initial={theme} />
        </div>
        <ComponentSheet theme={theme} startOnboarding={startOnboarding} />
      </div>
    </TooltipProvider>
  );
}
