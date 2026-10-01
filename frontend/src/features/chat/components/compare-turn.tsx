'use client';

import { Check, Square } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import type { Lane } from '@/shared/api/types';
import { useConfig } from '@/shared/api/use-config';
import { Button, cn, SegmentedControl } from '@/shared/ui';
import type { Answer } from '../answer';
import { formatCost, formatCount, formatSeconds, modelLabel } from '../format';
import type { Comparison } from '../turns';
import { AssistantMessage } from './assistant-message';
import { StatusLine } from './status-line';

const KEEPABLE = new Set(['complete', 'truncated']);

type Props = {
  comparison: Comparison;
  chatTitle: string | null;
  /** The latest question with nothing running: a lane can be answered again. */
  canRegenerate: boolean;
  onRegenerate: (answer: Answer) => void;
  onStop: (lane: Lane) => void;
  onPrefer: (answer: Answer) => void;
};

function keepable(answer: Answer | null): answer is Answer {
  return Boolean(answer?.messageId && KEEPABLE.has(answer.status));
}

/**
 * Two models, one question: two columns with model, time to first text, total
 * time, tokens and cost, each with its own stop and "keep this answer". Wider than the reading
 * column when there is room; below 672 px of width the columns become tabs.
 */
export function CompareTurn({ comparison, chatTitle, canRegenerate, onRegenerate, onStop, onPrefer }: Props) {
  const t = useTranslations('chat.compare');
  const { data: config } = useConfig();
  const [tab, setTab] = useState<Lane>('a');
  const { a, b } = comparison;
  const chosen = comparison.preferred === 'a' ? a : b;
  const other = comparison.preferred === 'a' ? b : a;
  // What really goes into the history: the kept answer, or the other one if the kept one failed.
  const kept = keepable(chosen) ? chosen : keepable(other) ? other : null;
  const settled = [a, b].every((answer) => answer && answer.status !== 'streaming');
  const label = (answer: Answer | null, lane: Lane) =>
    modelLabel(config?.models, answer?.model ?? null) || t(lane === 'a' ? 'laneA' : 'laneB');

  return (
    <section
      aria-label={t('label')}
      className="@container flex flex-col gap-4"
      // Breaks out of the reading column up to the page width (the chat scroller is the container).
      style={{
        width: 'min(100cqw, var(--container-page))',
        marginInline: 'calc((100% - min(100cqw, var(--container-page))) / 2)',
      }}
    >
      <SegmentedControl
        label={t('tabs')}
        className="w-fit @2xl:hidden"
        value={tab}
        onValueChange={setTab}
        options={[
          { value: 'a', label: label(a, 'a') },
          { value: 'b', label: label(b, 'b') },
        ]}
      />
      <div className="grid gap-8 @2xl:grid-cols-2 @2xl:gap-0">
        {(['a', 'b'] as const).map((lane) => {
          const answer = lane === 'a' ? a : b;
          return (
            <CompareColumn
              key={lane}
              lane={lane}
              title={label(answer, lane)}
              answer={answer}
              hiddenWhenNarrow={tab !== lane}
              kept={kept !== null && kept === answer}
              chatTitle={chatTitle}
              onRegenerate={canRegenerate && (answer?.messageId || answer?.error) ? () => onRegenerate(answer) : undefined}
              onStop={() => onStop(lane)}
              onPrefer={keepable(answer) && kept !== answer ? () => onPrefer(answer) : undefined}
            />
          );
        })}
      </div>
      {settled && kept && <p className="text-footnote text-ink-muted">{t('hint', { model: label(kept, kept.lane) })}</p>}
    </section>
  );
}

type ColumnProps = {
  lane: Lane;
  title: string;
  answer: Answer | null;
  hiddenWhenNarrow: boolean;
  kept: boolean;
  chatTitle: string | null;
  onRegenerate?: () => void;
  onStop: () => void;
  onPrefer?: () => void;
};

function CompareColumn({ lane, title, answer, hiddenWhenNarrow, kept, chatTitle, onRegenerate, onStop, onPrefer }: ColumnProps) {
  const t = useTranslations('chat.compare');
  const running = !answer || (answer.live && answer.status === 'streaming');
  return (
    <section
      aria-label={t('column', { model: title })}
      className={cn(
        'flex min-w-0 flex-col gap-4',
        hiddenWhenNarrow && 'hidden @2xl:flex',
        lane === 'a' ? '@2xl:pr-6' : '@2xl:border-l @2xl:border-hairline @2xl:pl-6',
      )}
    >
      <header className="flex flex-col gap-1">
        <div className="flex min-h-7 items-center justify-between gap-2">
          <h3 className="min-w-0 truncate text-body font-semibold">{title}</h3>
          {running ? (
            <Button size="sm" variant="ghost" className="-mr-2" onClick={onStop}>
              <Square aria-hidden className="size-3! fill-current" />
              {t('stop')}
            </Button>
          ) : kept ? (
            <span className="inline-flex items-center gap-1 text-caption font-medium text-ink">
              <Check aria-hidden className="size-3.5" />
              {t('kept')}
            </span>
          ) : onPrefer ? (
            <Button size="sm" variant="ghost" className="-mr-2" onClick={onPrefer}>
              {t('keep')}
            </Button>
          ) : null}
        </div>
        <Metrics answer={answer} />
      </header>
      {answer ? (
        <AssistantMessage answer={answer} chatTitle={chatTitle} onRegenerate={onRegenerate} inComparison />
      ) : (
        <StatusLine phase="retrieving" startedAt={null} />
      )}
    </section>
  );
}

/** Seconds since `startedAt`, ticking while the answer runs (only this text re-renders). */
function LiveSeconds({ startedAt }: { startedAt: number }) {
  const t = useTranslations('chat.compare');
  const locale = useLocale();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return <>{t('seconds', { seconds: formatSeconds(Math.max(0, now - startedAt), locale) })}</>;
}

function Metrics({ answer }: { answer: Answer | null }) {
  const t = useTranslations('chat.compare');
  const locale = useLocale();
  const streaming = answer?.live && answer.status === 'streaming';
  const ttft = answer?.latency?.ttft ?? answer?.firstTokenMs ?? null;
  const total = answer?.latency?.total ?? null;
  const usage = answer?.usage;
  const items: Array<[string, ReactNode]> = [];
  if (ttft !== null) items.push([t('ttft'), t('seconds', { seconds: formatSeconds(ttft, locale) })]);
  if (total !== null) items.push([t('total'), t('seconds', { seconds: formatSeconds(total, locale) })]);
  else if (streaming && answer?.startedAt) {
    items.push([t('total'), <LiveSeconds key="live" startedAt={answer.startedAt} />]);
  }
  if (usage) {
    items.push([
      t('tokens'),
      t('tokensValue', { input: formatCount(usage.input_tokens, locale), output: formatCount(usage.output_tokens, locale) }),
    ]);
  }
  if (answer?.costUsd != null) items.push([t('cost'), formatCost(answer.costUsd, locale)]);
  if (items.length === 0) return <p className="h-4 text-caption text-ink-muted" aria-hidden />;
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-caption tabular-nums">
      {items.map(([name, value]) => (
        <div key={name} className="flex gap-1">
          <dt className="text-ink-muted">{name}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
