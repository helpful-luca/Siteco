'use client';

import { KeyRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useConfig } from '@/shared/api/use-config';

/** Persistent hint when the app runs without an API key (search-only mode). */
export function GlobalBanner() {
  const t = useTranslations('banner');
  const { data } = useConfig();
  if (data?.llm_status !== 'missing_key') return null;
  return (
    <div
      role="note"
      className="mx-2 mt-2 flex gap-3 rounded-card bg-fill px-4 py-3 ring-1 ring-inset ring-hairline lg:mx-5 lg:mt-3"
    >
      <KeyRound aria-hidden className="mt-0.5 size-4 shrink-0 text-sodium-ink" />
      <div className="min-w-0 text-footnote">
        <p className="font-medium">{t('missingKey')}</p>
        <p className="mt-0.5 text-ink-muted">{t('missingKeyHint')}</p>
      </div>
    </div>
  );
}
