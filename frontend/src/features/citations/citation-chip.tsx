'use client';

import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SourceOut } from '@/shared/api/types';
import { cn, HoverCard } from '@/shared/ui';

type Props = {
  n: number;
  source: SourceOut | undefined;
  citedText: string | null;
  active?: boolean;
  onOpen?: () => void;
};

/**
 * Numbered source reference in the answer text. A real button: hover and keyboard focus show the
 * cited sentence, a click opens the source (annex 11, 8.4). Deleted sources stay readable but
 * open nothing (annex 10, E13).
 */
export function CitationChip({ n, source, citedText, active = false, onOpen }: Props) {
  const t = useTranslations('chat.sources');
  const deleted = !source || source.deleted;
  const label = source
    ? source.page !== null
      ? t('chip', { n, file: source.filename, page: source.page })
      : t('chipNoPage', { n, file: source.filename })
    : String(n);

  return (
    <HoverCard
      content={
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1.5 text-footnote font-medium">
            <FileText aria-hidden className="size-3.5 shrink-0 text-ink-muted" />
            <span className={cn('truncate', deleted && 'text-ink-muted line-through')}>{source?.filename}</span>
          </p>
          <p className="mt-1 text-caption text-ink-muted">
            {deleted ? t('deleted') : source.page !== null ? t('page', { page: source.page }) : t('passage')}
          </p>
          {(citedText || source?.snippet) && (
            <p className="mt-2 line-clamp-6 text-footnote">„{citedText || source?.snippet}“</p>
          )}
        </div>
      }
    >
      <button
        type="button"
        aria-label={deleted ? `${label}, ${t('deleted')}` : label}
        aria-pressed={deleted ? undefined : active}
        aria-disabled={deleted || undefined}
        onClick={deleted ? undefined : onOpen}
        className={cn(
          'mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-full px-1',
          'align-middle text-[11px] leading-none font-semibold tabular-nums',
          'transition-[background-color,color] duration-200 ease-out-soft',
          deleted
            ? 'bg-fill-strong text-ink-muted line-through'
            : active
              ? 'bg-sodium text-on-sodium'
              : 'bg-highlight text-sodium-ink hover:bg-sodium hover:text-on-sodium',
        )}
      >
        {n}
      </button>
    </HoverCard>
  );
}
