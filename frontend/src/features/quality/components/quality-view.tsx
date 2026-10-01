'use client';

import { Gauge } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Page } from '@/features/shell';
import { ApiError } from '@/shared/api/client';
import { Badge, Button, DelayedSpinner } from '@/shared/ui';
import { useEvalResults } from '../queries';
import { CategoryBreakdown } from './category-breakdown';
import { ConfigTable } from './config-table';
import { Explainer } from './explainer';
import { FullContext } from './full-context';
import { GenerationResults } from './generation-results';
import { Misses } from './misses';
import { Summary } from './summary';

/**
 * Quality (master spec 6.7, annex 11, 8.9): what `make eval` measured, nothing else. No run
 * button: the eval takes CPU minutes and its own data; the numbers come with the image.
 */
export function QualityView() {
  const t = useTranslations('quality');
  const format = useFormatter();
  const { data, error, refetch, isPending } = useEvalResults();

  if (isPending) {
    return (
      <Page width="page" center>
        <div className="grid place-items-center">
          <DelayedSpinner label={t('loading')} className="size-5" />
        </div>
      </Page>
    );
  }
  if (!data) {
    const missing = error instanceof ApiError && error.code === 'EVAL_RESULTS_MISSING';
    return (
      <Page width="reading" center>
        <div className="grid size-12 place-items-center rounded-card bg-fill text-ink-muted ring-1 ring-inset ring-hairline [&_svg]:size-6">
          <Gauge aria-hidden />
        </div>
        <h1 className="mt-4 text-title-2 font-semibold">{missing ? t('empty.title') : t('loadError')}</h1>
        {missing ? (
          <p className="mt-2 max-w-[60ch] text-reading text-ink-muted">
            {t.rich('empty.text', { code: (chunks) => <code className="font-mono text-[0.9em] text-ink">{chunks}</code> })}
          </p>
        ) : (
          <Button className="mt-6 w-fit" onClick={() => refetch()}>
            {t('retry')}
          </Button>
        )}
      </Page>
    );
  }

  const [standard] = data.configs.filter((c) => c.default);
  const measured = format.dateTime(new Date(data.created_at), { dateStyle: 'long' });

  return (
    <Page width="page">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title-2 font-semibold">{t('title')}</h1>
          {data.stale && <Badge tone="working">{t('stale.badge')}</Badge>}
        </div>
        <p className="max-w-[68ch] text-reading text-ink-muted">
          {t('lead', { questions: data.dataset.questions, documents: data.dataset.documents, pages: data.dataset.pages })}
        </p>
        <p className="text-footnote text-ink-muted">
          {t('measured', { date: measured, commit: data.commit })}
        </p>
        {data.stale && (
          <p role="note" className="max-w-[68ch] rounded-card bg-highlight/50 px-4 py-3 text-footnote text-ink">
            {t('stale.text')}
          </p>
        )}
      </header>

      <div className="mt-10 flex flex-col gap-12">
        {standard && <Summary config={standard} topK={Number(data.settings.top_k ?? 8)} />}
        <ConfigTable configs={data.configs} />
        <CategoryBreakdown configs={data.configs} dataset={data.dataset} />
        <div className="grid gap-12 @container lg:grid-cols-2 lg:gap-8">
          <FullContext result={data.full_context} limit={Number(data.settings.full_context_max_tokens ?? 0)} />
          <Misses misses={data.misses} />
        </div>
        <GenerationResults generation={data.generation ?? null} />
        <Explainer topK={Number(data.settings.top_k ?? 8)} candidates={Number(data.settings.candidates ?? 20)} />
      </div>
    </Page>
  );
}
