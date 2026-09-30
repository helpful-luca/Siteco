'use client';

import { FileX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SourceOut } from '@/shared/api/types';

/**
 * What stays readable of a deleted source (master spec 6.3, annex 11 8.5): the stored cited
 * sentence and snippet. WP-G may redact the snapshot on deletion; empty parts are then left out.
 */
export function snapshotOf(source: SourceOut, citedText: string | null): { cited: string | null; snippet: string | null } {
  const cited = citedText?.trim() || null;
  const snippet = source.snippet.trim() || null;
  return { cited, snippet: snippet && snippet !== cited ? snippet : null };
}

export function DeletedSource({ source, citedText }: { source: SourceOut; citedText: string | null }) {
  const t = useTranslations('viewer.source');
  const { cited, snippet } = snapshotOf(source, citedText);
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex gap-3">
        <FileX aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-muted" />
        <div>
          <h3 className="text-body font-medium">{t('deletedTitle')}</h3>
          <p className="mt-1 max-w-[60ch] text-footnote text-ink-muted">{t('deletedText')}</p>
        </div>
      </div>
      {cited && (
        <section>
          <h4 className="text-caption font-medium text-ink-muted">{t('cited')}</h4>
          <p className="text-mark mt-2 -mx-2 rounded-inner px-2 py-1 text-reading">{cited}</p>
        </section>
      )}
      {snippet && (
        <section>
          <h4 className="text-caption font-medium text-ink-muted">{t('snippet')}</h4>
          <p className="mt-2 text-body text-ink-muted">{snippet}</p>
        </section>
      )}
    </div>
  );
}
