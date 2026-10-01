'use client';

import { useTranslations } from 'next-intl';
import { FormGroup, FormText } from '@/shared/ui';

const TERMS = ['inSources', 'hit', 'mrr', 'latency', 'hybrid', 'stemming', 'limits'] as const;

/** What the numbers mean, in plain words. */
export function Explainer({ topK, candidates }: { topK: number; candidates: number }) {
  const t = useTranslations('quality.explain');
  return (
    <FormGroup title={t('title')}>
      {TERMS.map((term) => (
        <FormText key={term}>
          <span className="block font-medium">{t(`${term}.term`)}</span>
          <span className="mt-0.5 block max-w-[72ch] text-footnote text-ink-muted">{t(`${term}.text`, { k: topK, candidates })}</span>
        </FormText>
      ))}
    </FormGroup>
  );
}
