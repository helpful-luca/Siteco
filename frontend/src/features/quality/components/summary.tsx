'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { EvalConfigOut } from '@/shared/api/types';
import { formatMs, formatScore, formatShare } from '../format';
import { ShareBar } from './share-bar';

/** The default configuration in four numbers, the one that matters most first. */
export function Summary({ config, topK }: { config: EvalConfigOut; topK: number }) {
  const t = useTranslations('quality');
  const locale = useLocale();
  const m = config.metrics;
  const items = [
    { key: 'inSources', value: formatShare(m.in_sources, locale), share: m.in_sources, hint: t('metric.inSources.hint', { k: topK }) },
    { key: 'hit5', value: formatShare(m.hit_at_5, locale), share: m.hit_at_5, hint: t('metric.hit5.hint') },
    { key: 'hit1', value: formatShare(m.hit_at_1, locale), share: m.hit_at_1, hint: t('metric.hit1.hint') },
    { key: 'mrr', value: formatScore(m.mrr_at_10, locale), share: m.mrr_at_10, hint: t('metric.mrr.hint') },
  ] as const;
  return (
    <section aria-labelledby="quality-summary" className="flex flex-col">
      <h2 id="quality-summary" className="px-4 pb-2 text-footnote font-medium text-ink-muted">
        {t('summary.title')}
      </h2>
      <div className="rounded-card bg-surface ring-1 ring-inset ring-hairline">
        <dl className="grid grid-cols-2 md:grid-cols-4">
          {items.map((item, index) => (
            <div
              key={item.key}
              className="flex flex-col gap-2 border-hairline px-4 py-4 not-first:border-l max-md:nth-3:border-l-0 max-md:nth-[n+3]:border-t"
            >
              <dt className="text-footnote font-medium text-ink-muted">{t(`metric.${item.key}.label`)}</dt>
              <dd className="flex flex-col gap-2">
                <span className="text-title-1 font-semibold tabular-nums">{item.value}</span>
                <ShareBar value={item.share} accent={index === 0} />
                <span className="text-caption text-ink-muted">{item.hint}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-hairline px-4 py-3 text-footnote text-ink-muted">
          {t('summary.latency', {
            p50: formatMs(m.latency_p50_ms, locale),
            p95: formatMs(m.latency_p95_ms, locale),
            questions: m.questions,
          })}
        </p>
      </div>
    </section>
  );
}
