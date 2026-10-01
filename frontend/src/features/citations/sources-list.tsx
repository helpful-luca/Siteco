'use client';

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
 * The sources of one answer, grouped by document (annex 11, 8.4): cited sources first, the other
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
      <ul className="flex flex-col gap-1">
        {groupByDocument(shown).map((group) => (
          <li key={group.documentId} className="-mx-2 flex flex-wrap items-center gap-x-0.5 gap-y-1">
            {group.sources.map((source, i) => {
              const page = source.page !== null ? t('page', { page: source.page }) : t('passage');
              return (
                <button
                  key={source.id}
                  type="button"
                  aria-pressed={source.id === activeSourceId}
                  onClick={() => onOpenSource?.(source, citedTextOf(source))}
                  className={cn(
                    'flex h-7 max-w-full min-w-0 items-center gap-2 rounded-control px-2 text-footnote text-ink-muted pointer-coarse:h-11',
                    'transition-colors hover:bg-fill hover:text-ink',
                    source.id === activeSourceId && 'bg-fill text-ink',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums',
                      source.deleted ? 'bg-fill text-ink-muted' : 'bg-fill-strong text-ink',
                    )}
                  >
                    {source.index}
                  </span>
                  {/* A long name gives way inside its stem; extension and page stay readable. */}
                  <span className={cn('flex min-w-0', source.deleted && 'line-through')}>
                    {i === 0 && <FileLabel name={group.filename} />}
                    <span className="shrink-0 whitespace-pre">{i === 0 ? `, ${page}` : page}</span>
                  </span>
                  {source.deleted && i === 0 && <span className="shrink-0">{t('deleted')}</span>}
                </button>
              );
            })}
          </li>
        ))}
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
