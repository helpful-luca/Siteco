'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { EvalConfigOut } from '@/shared/api/types';
import { cn } from '@/shared/ui';
import { configName, formatMs, formatScore, formatShare } from '../format';
import { ShareBar } from './share-bar';

export function ConfigLabel({ config }: { config: Pick<EvalConfigOut, 'search' | 'stemming'> }) {
  const t = useTranslations('quality');
  const { search, stemming } = configName(config);
  return (
    <>
      {t(search)}
      {stemming && <span className="text-ink-muted">, {t(stemming)}</span>}
    </>
  );
}

/**
 * Configuration by metric (annex 11, 8.9). Wide: a table with bars under the shares; narrow
 * (container below 640 px): one block per configuration with the three shares.
 */
export function ConfigTable({ configs }: { configs: EvalConfigOut[] }) {
  const t = useTranslations('quality');
  const locale = useLocale();
  const head = 'h-8 px-3 text-left align-middle text-caption font-medium text-ink-muted';
  const shares = ['hit_at_1', 'hit_at_5', 'in_sources'] as const;
  return (
    <section aria-labelledby="quality-configs" className="@container flex flex-col">
      <h2 id="quality-configs" className="px-4 pb-2 text-footnote font-medium text-ink-muted">
        {t('configs.title')}
      </h2>
      <div className="overflow-hidden rounded-card bg-surface ring-1 ring-inset ring-hairline">
        <table className="hidden w-full table-fixed border-collapse @2xl:table">
          <caption className="sr-only">{t('configs.caption')}</caption>
          <thead className="border-b border-hairline">
            <tr>
              <th scope="col" className={`${head} w-[28%] pl-4`}>
                {t('configs.config')}
              </th>
              {shares.map((key) => (
                <th key={key} scope="col" className={`${head} text-right`}>
                  {t(`column.${key}`)}
                </th>
              ))}
              <th scope="col" className={`${head} text-right`}>
                {t('column.mrr_at_10')}
              </th>
              <th scope="col" className={`${head} w-44 pr-4 text-right`}>
                {t('column.latency')}
              </th>
            </tr>
          </thead>
          <tbody className="[&>tr:nth-child(even)]:bg-fill/60">
            {configs.map((config) => (
              <tr key={config.id}>
                <th scope="row" className="px-3 py-3 pl-4 text-left align-top text-body font-normal">
                  <span className="block truncate">
                    <ConfigLabel config={config} />
                  </span>
                  {config.default && <span className="text-caption font-medium text-sodium-ink">{t('configs.default')}</span>}
                </th>
                {shares.map((key) => (
                  <td key={key} className="px-3 py-3 align-top">
                    <span className={cn('block text-right text-body tabular-nums', config.default && 'font-semibold')}>
                      {formatShare(config.metrics[key], locale)}
                    </span>
                    <ShareBar value={config.metrics[key]} accent={config.default} className="mt-1.5" />
                  </td>
                ))}
                <td className="px-3 py-3 text-right align-top text-body tabular-nums">{formatScore(config.metrics.mrr_at_10, locale)}</td>
                <td className="px-3 py-3 pr-4 text-right align-top text-body whitespace-nowrap tabular-nums">
                  {t('configs.ms', { p50: formatMs(config.metrics.latency_p50_ms, locale), p95: formatMs(config.metrics.latency_p95_ms, locale) })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="@2xl:hidden">
          {configs.map((config) => (
            <li
              key={config.id}
              className="relative px-4 py-3 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-4 not-first:before:h-px not-first:before:bg-hairline"
            >
              <p className="text-body">
                <ConfigLabel config={config} />
                {config.default && <span className="ml-2 text-caption font-medium text-sodium-ink">{t('configs.default')}</span>}
              </p>
              <dl className="mt-2 grid grid-cols-3 gap-3">
                {shares.map((key) => (
                  <div key={key}>
                    <dt className="text-caption text-ink-muted">{t(`column.${key}`)}</dt>
                    <dd className="text-body tabular-nums">{formatShare(config.metrics[key], locale)}</dd>
                    <ShareBar value={config.metrics[key]} accent={config.default} className="mt-1" />
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-caption text-ink-muted tabular-nums">
                {t('column.mrr_at_10')} {formatScore(config.metrics.mrr_at_10, locale)},{' '}
                {t('configs.ms', { p50: formatMs(config.metrics.latency_p50_ms, locale), p95: formatMs(config.metrics.latency_p95_ms, locale) })}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
