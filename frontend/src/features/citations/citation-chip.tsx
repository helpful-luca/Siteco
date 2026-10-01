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
 * cited sentence, a click opens the source. A deleted source keeps file and page
 * but no text; a click opens the panel that says it was deleted.
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
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-inner bg-fill-strong text-footnote font-semibold tabular-nums"
            >
              {n}
            </span>
            <div className="min-w-0">
              <p className={cn('flex min-w-0 items-center gap-1.5 text-footnote font-medium', deleted && 'text-ink-muted line-through')}>
                <FileText aria-hidden className="size-3.5 shrink-0 text-ink-muted" />
                <span className="truncate">{source?.filename}</span>
              </p>
              <p className="text-caption text-ink-muted">
                {deleted ? t('deleted') : source.page !== null ? t('page', { page: source.page }) : t('passage')}
              </p>
            </div>
          </div>
          {!deleted && (citedText || source?.snippet) && (
            // The cited words look as they will in the document: marked like with a text marker.
            <p className="mt-3 line-clamp-6 text-footnote">
              <mark className="rounded-[3px] bg-highlight box-decoration-clone px-0.5 text-on-highlight">
                {citedText || source?.snippet}
              </mark>
            </p>
          )}
          {!deleted && <p className="mt-3 text-caption text-ink-muted">{t('openHint')}</p>}
        </div>
      }
    >
      <button
        type="button"
        aria-label={deleted ? `${label}, ${t('deleted')}` : label}
        aria-pressed={active}
        onClick={onOpen}
        className={cn(
          'mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-full px-1',
          'align-middle text-[11px] leading-none font-semibold tabular-nums',
          'transition-[background-color,color] duration-200 ease-out-soft',
          deleted
            ? cn('text-ink-muted line-through', active ? 'bg-hairline-strong' : 'bg-fill-strong hover:bg-hairline-strong')
            : active
              ? 'bg-accent text-on-accent'
              : // Red only for the open source; hovering darkens the chip like any other control.
                'bg-fill-strong text-ink hover:bg-ink/20',
        )}
      >
        {n}
      </button>
    </HoverCard>
  );
}
