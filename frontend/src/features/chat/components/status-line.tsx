'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { Answer } from '../answer';

/** 8 s without the first text: say it takes longer. */
export const SLOW_AFTER_MS = 8_000;

/**
 * "Durchsuche Dokumente", "Formuliere Antwort", "Neuer Versuch". With `startedAt` it also says when
 * the first text takes longer than usual.
 */
export function StatusLine({ phase, startedAt }: { phase: NonNullable<Answer['phase']>; startedAt: number | null }) {
  const t = useTranslations('chat.status');
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (startedAt === null) return; // text is already arriving: nothing is slow
    const wait = Math.max(0, SLOW_AFTER_MS - (Date.now() - startedAt));
    const timer = setTimeout(() => setSlow(true), wait);
    return () => clearTimeout(timer);
  }, [startedAt]);

  const label = phase === 'retrying' ? t('retrying') : phase === 'generating' ? t('generating') : t('retrieving');
  return (
    <div className="flex h-7 items-center gap-2 text-footnote text-ink-muted">
      {/* A light passing over the words instead of a spinner; static under reduced motion. */}
      <span className="shimmer-text font-medium">{label}</span>
      {slow && <span className="text-ink-muted/80">{t('slow')}</span>}
    </div>
  );
}
