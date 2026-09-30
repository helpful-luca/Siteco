'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { fetchJson } from '@/shared/api/client';
import type { ConfigOut } from '@/shared/api/types';

/** Persistent hint when the app runs without an API key (search-only mode). */
export function GlobalBanner() {
  const t = useTranslations('banner');
  const { data } = useQuery({ queryKey: ['config'], queryFn: () => fetchJson<ConfigOut>('/api/config') });
  if (data?.llm_status !== 'missing_key') return null;
  return (
    <div role="note" className="mx-auto mt-4 max-w-3xl rounded-2xl px-5 py-3 text-sm ring-1 ring-current/15">
      <p className="font-medium">{t('missingKey')}</p>
      <p className="opacity-70">{t('missingKeyHint')}</p>
    </div>
  );
}
