'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { EvalOut } from '@/shared/api/types';
import { FormGroup, FormText } from '@/shared/ui';
import { formatShare } from '../format';

/** Answer quality per model, only when someone ran `make eval-generation` with a key (annex 10, N7). */
export function GenerationResults({ generation }: { generation: EvalOut['generation'] }) {
  const t = useTranslations('quality.generation');
  const locale = useLocale();
  if (!generation) {
    return (
      <FormGroup title={t('title')}>
        <FormText className="text-footnote text-ink-muted">
          {t.rich('missing', { code: (chunks) => <code className="font-mono text-[0.95em] text-ink">{chunks}</code> })}
        </FormText>
      </FormGroup>
    );
  }
  const head = 'h-8 px-3 text-right align-middle text-caption font-medium text-ink-muted';
  const usd = (value: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 3 }).format(value);
  const seconds = (ms: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(ms / 1000);
  return (
    <FormGroup title={t('title')} footer={t('footer', { judge: generation.judge_model })}>
      <div className="overflow-x-auto overscroll-contain">
        <table className="w-full min-w-[36rem] border-collapse">
          <caption className="sr-only">{t('title')}</caption>
          <thead className="border-b border-hairline">
            <tr>
              <th scope="col" className={`${head} pl-4 text-left`}>{t('model')}</th>
              <th scope="col" className={head}>{t('correct')}</th>
              <th scope="col" className={head}>{t('citations')}</th>
              <th scope="col" className={head}>{t('abstention')}</th>
              <th scope="col" className={head}>{t('cost')}</th>
              <th scope="col" className={`${head} pr-4`}>{t('latency')}</th>
            </tr>
          </thead>
          <tbody className="text-body tabular-nums [&>tr:nth-child(even)]:bg-fill/60">
            {generation.models.map((m) => (
              <tr key={m.model}>
                <th scope="row" className="px-3 py-2.5 pl-4 text-left font-normal">{m.model}</th>
                <td className="px-3 py-2.5 text-right">{formatShare(m.correct, locale)}</td>
                <td className="px-3 py-2.5 text-right">{formatShare(m.citation_accuracy, locale)}</td>
                <td className="px-3 py-2.5 text-right">{formatShare(m.abstention, locale)}</td>
                <td className="px-3 py-2.5 text-right">{usd(m.cost_usd)}</td>
                <td className="px-3 py-2.5 pr-4 text-right">{t('seconds', { seconds: seconds(m.latency_p50_ms) })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </FormGroup>
  );
}
