'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { EvalConfigOut, EvalOut, QuestionCategory } from '@/shared/api/types';
import { SegmentedControl } from '@/shared/ui';
import { formatShare } from '../format';
import { ShareBar } from './share-bar';

const CATEGORIES: QuestionCategory[] = ['factual', 'exact_code', 'cross_lingual', 'follow_up', 'unanswerable'];
const SHARES = ['hit_at_1', 'hit_at_5', 'in_sources'] as const;

/** The three retrievers to compare per category: the default, vectors alone, BM25 alone. */
function choices(configs: EvalConfigOut[]): EvalConfigOut[] {
  const standard = configs.find((c) => c.default);
  const stemming = standard?.stemming ?? 'german';
  return [
    standard,
    configs.find((c) => c.search === 'dense'),
    configs.find((c) => c.search === 'bm25' && c.stemming === stemming),
  ].filter((c): c is EvalConfigOut => Boolean(c));
}

/** Breakdown by question category (master spec 6.7), switchable between the retrievers. */
export function CategoryBreakdown({ configs, dataset }: { configs: EvalConfigOut[]; dataset: EvalOut['dataset'] }) {
  const t = useTranslations('quality');
  const locale = useLocale();
  const options = choices(configs);
  const [selected, setSelected] = useState(options[0]?.id ?? '');
  const config = options.find((c) => c.id === selected) ?? options[0];
  if (!config) return null;

  return (
    <section aria-labelledby="quality-categories" className="@container flex flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-2">
        <h2 id="quality-categories" className="text-footnote font-medium text-ink-muted">
          {t('categories.title')}
        </h2>
        <SegmentedControl
          label={t('categories.choose')}
          value={config.id}
          onValueChange={setSelected}
          options={options.map((c) => ({ value: c.id, label: t(`search.${c.search}`) }))}
        />
      </div>
      <div className="rounded-card bg-surface ring-1 ring-inset ring-hairline">
        <ul>
          {CATEGORIES.map((category) => {
            const metrics = config.by_category[category];
            const count = dataset.by_category[category] ?? 0;
            return (
              <li
                key={category}
                className="relative grid gap-3 px-4 py-3 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-4 not-first:before:h-px not-first:before:bg-hairline @2xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] @2xl:gap-6"
              >
                <div className="min-w-0">
                  <p className="text-body">
                    {t(`category.${category}.name`)}{' '}
                    <span className="text-footnote text-ink-muted">{t('categories.count', { count })}</span>
                  </p>
                  <p className="mt-0.5 text-footnote text-ink-muted">{t(`category.${category}.text`)}</p>
                </div>
                {metrics ? (
                  <dl className="col-span-full grid grid-cols-3 gap-3 @2xl:col-span-3 @2xl:gap-6">
                    {SHARES.map((key) => (
                      <div key={key}>
                        <dt className="text-caption text-ink-muted">{t(`column.${key}`)}</dt>
                        <dd className="text-body tabular-nums">{formatShare(metrics[key], locale)}</dd>
                        <ShareBar value={metrics[key]} accent={key === 'in_sources'} className="mt-1" />
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="col-span-full self-center text-footnote text-ink-muted @2xl:col-span-3">{t('categories.unanswerable')}</p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
