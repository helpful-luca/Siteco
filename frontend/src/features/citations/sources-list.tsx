'use client';

import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { CitationOut, SourceOut } from '@/shared/api/types';
import { cn, FileLabel } from '@/shared/ui';

type Props = {
  sources: SourceOut[];
  citations: CitationOut[];
  activeSourceId?: string | null;
  onOpenSource?: (source: SourceOut, citedText: string | null) => void;
};

type Group = { documentId: string; filename: string; sources: SourceOut[] };

function groupByDocument(sources: SourceOut[]): Group[] {
  const groups = new Map<string, Group>();
  for (const source of [...sources].sort((a, b) => a.index - b.index)) {
    const group = groups.get(source.document_id) ?? { documentId: source.document_id, filename: source.filename, sources: [] };
    group.sources.push(source);
    groups.set(source.document_id, group);
  }
  return [...groups.values()];
}

/**
 * The sources of one answer, grouped by document: cited sources first, the other
 * retrieved passages behind a disclosure. The full-size targets for the small chips in the text.
 */
export function SourcesList({ sources, citations, activeSourceId = null, onOpenSource }: Props) {
  const t = useTranslations('chat.sources');
  const [showAll, setShowAll] = useState(false);
  const cited = new Set(citations.map((c) => c.source_id));
  const primary = sources.filter((s) => cited.has(s.id));
  const rest = sources.filter((s) => !cited.has(s.id));
  const shown = showAll ? [...primary, ...rest] : primary;
  if (sources.length === 0) return null;

  const citedTextOf = (source: SourceOut) => citations.find((c) => c.source_id === source.id)?.cited_text ?? null;

  return (
    <div className="flex flex-col gap-1">
      <h3 className="sr-only">{t('label')}</h3>
      {/*
        One line per document like a Finder path: its glyph and name in quiet text, then its
        passages as numbered page buttons. The buttons are the full-size targets of the chips.
      */}
      <ul className="flex flex-col gap-1">
        {groupByDocument(shown).map((group) => {
          const deleted = group.sources.every((source) => source.deleted);
          return (
            <li key={group.documentId} className="-mx-2 flex flex-wrap items-center gap-x-0.5 gap-y-1">
              <span
                className={cn(
                  'flex h-7 max-w-full min-w-0 items-center gap-2 pr-1 pl-2 text-footnote text-ink-muted pointer-coarse:h-11',
                  deleted && 'line-through',
                )}
              >
                <FileText aria-hidden className="size-4 shrink-0 opacity-70" />
                <FileLabel name={group.filename} />
                {deleted && <span className="shrink-0 no-underline">{t('deleted')}</span>}
              </span>
              {group.sources.map((source) => {
                const page = source.page !== null ? t('page', { page: source.page }) : t('passage');
                const label =
                  source.page !== null
                    ? t('chip', { n: source.index, file: group.filename, page: source.page })
                    : t('chipNoPage', { n: source.index, file: group.filename });
                return (
                  <button
                    key={source.id}
                    type="button"
                    aria-label={source.deleted ? `${label}, ${t('deleted')}` : label}
                    aria-pressed={source.id === activeSourceId}
                    onClick={() => onOpenSource?.(source, citedTextOf(source))}
                    className={cn(
                      'flex h-7 shrink-0 items-center gap-1.5 rounded-full pr-3 pl-1 text-footnote text-ink-muted pointer-coarse:h-11',
                      'transition-colors hover:bg-fill hover:text-ink',
                      source.id === activeSourceId && 'bg-fill text-ink',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                        source.id === activeSourceId
                          ? 'bg-accent text-on-accent'
                          : source.deleted
                            ? 'bg-fill text-ink-muted'
                            : 'bg-fill-strong text-ink',
                      )}
                    >
                      {source.index}
                    </span>
                    <span aria-hidden className={cn('whitespace-pre', source.deleted && 'line-through')}>
                      {page}
                    </span>
                  </button>
                );
              })}
            </li>
          );
        })}
      </ul>
      {rest.length > 0 && (
        <button
          type="button"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
          className="-mx-2 flex h-7 w-fit items-center rounded-control px-2 text-footnote text-ink-muted transition-colors hover:bg-fill hover:text-ink pointer-coarse:h-11"
        >
          {showAll ? t('less') : t('more', { count: rest.length })}
        </button>
      )}
    </div>
  );
}
