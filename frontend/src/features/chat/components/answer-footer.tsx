'use client';

import { ChevronDown, PanelRight, RotateCcw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { useConfig } from '@/shared/api/use-config';
import { Button, cn, CopyButton, Tooltip } from '@/shared/ui';
import type { Answer } from '../answer';
import { formatCost, formatCount, formatSeconds, modelLabel } from '../format';

type Props = {
  answer: Answer;
  onRegenerate?: () => void;
  onOpenArtifact?: () => void;
  /** A comparison column shows model, times and cost in its own header. */
  showDetails?: boolean;
  className?: string;
};

/** Quiet actions under an answer, then a one-line summary that discloses the details (annex 11, 8.4). */
export function AnswerFooter({ answer, onRegenerate, onOpenArtifact, showDetails = true, className }: Props) {
  const t = useTranslations('chat');
  const locale = useLocale();
  const { data: config } = useConfig();
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const model = modelLabel(config?.models, answer.model);
  const total = answer.latency?.total ?? null;
  const summary =
    model && total !== null
      ? answer.costUsd !== null && answer.costUsd > 0
        ? t('detail.summary', { model, seconds: formatSeconds(total, locale), cost: formatCost(answer.costUsd, locale) })
        : t('detail.summaryNoCost', { model, seconds: formatSeconds(total, locale) })
      : null;

  const rows: Array<[string, string]> = [];
  if (model) rows.push([t('detail.model'), model]);
  if (answer.sourcesMode) rows.push([t('detail.basis'), t(`detail.basisValue.${answer.sourcesMode}`)]);
  if (answer.usage) {
    rows.push([t('detail.input'), t('detail.tokens', { count: formatCount(answer.usage.input_tokens, locale) })]);
    rows.push([t('detail.output'), t('detail.tokens', { count: formatCount(answer.usage.output_tokens, locale) })]);
    rows.push([t('detail.cacheRead'), t('detail.tokens', { count: formatCount(answer.usage.cache_read_input_tokens, locale) })]);
  }
  if (answer.costUsd !== null) rows.push([t('detail.cost'), formatCost(answer.costUsd, locale)]);
  if (answer.latency?.ttft != null) {
    rows.push([t('detail.ttft'), t('detail.seconds', { seconds: formatSeconds(answer.latency.ttft, locale) })]);
  }
  if (total !== null) rows.push([t('detail.total'), t('detail.seconds', { seconds: formatSeconds(total, locale) })]);

  return (
    <div className={className}>
      {/* The first glyph sits on the text edge: 28 px buttons pull back 6 px, 44 px touch ones 14 px. */}
      <div className="-ml-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 pointer-coarse:-ml-3.5">
        {answer.text && <CopyButton text={answer.text} label={t('answer.copy')} copiedLabel={t('answer.copied')} />}
        {onRegenerate && (
          <Tooltip content={t('answer.regenerate')}>
            <Button icon variant="ghost" size="sm" aria-label={t('answer.regenerate')} onClick={onRegenerate}>
              <RotateCcw />
            </Button>
          </Tooltip>
        )}
        {onOpenArtifact && (
          <Tooltip content={t('answer.openArtifact')}>
            <Button icon variant="ghost" size="sm" aria-label={t('answer.openArtifact')} onClick={onOpenArtifact}>
              <PanelRight />
            </Button>
          </Tooltip>
        )}
        {showDetails && summary && rows.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailId}
            onClick={() => setOpen((value) => !value)}
            className="ml-1 flex h-7 items-center gap-1 rounded-control px-2 text-caption text-ink-muted transition-colors hover:bg-fill hover:text-ink pointer-coarse:h-11"
          >
            <span className="sr-only">{t('detail.toggle')}: </span>
            {summary}
            <ChevronDown aria-hidden className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {open && (
        <dl
          id={detailId}
          className="mt-2 grid max-w-sm grid-cols-[auto_1fr] gap-x-6 gap-y-1 rounded-card bg-fill px-4 py-3 text-footnote"
        >
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-right tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
