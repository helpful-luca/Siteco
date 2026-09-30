'use client';

import { ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SourceOut } from '@/shared/api/types';
import { buttonStyles } from '@/shared/ui';

/**
 * A cited source in the right panel. For now the cited sentence, lit like the passage will be in
 * the document, plus the snippet and a link to the file. WP-E replaces this body with the viewer
 * that highlights the sentence inside the page; `openSource` stays the entry point.
 */
export function SourceView({ source, citedText }: { source: SourceOut; citedText: string | null }) {
  const t = useTranslations('viewer.source');
  const fileUrl = `/api/documents/${source.document_id}/file${source.page !== null ? `#page=${source.page}` : ''}`;
  return (
    <div className="flex flex-col gap-6 p-6">
      {citedText && (
        <section>
          <h3 className="text-caption font-medium text-ink-muted">{t('cited')}</h3>
          <p className="lamp-on mt-2 -mx-2 rounded-inner bg-highlight px-2 py-1 text-reading">{citedText}</p>
        </section>
      )}
      <section>
        <h3 className="text-caption font-medium text-ink-muted">{t('snippet')}</h3>
        <p className="mt-2 text-body text-ink-muted">{source.snippet}</p>
      </section>
      {source.deleted ? (
        <p className="text-footnote text-ink-muted">{t('deleted')}</p>
      ) : (
        <div className="flex flex-col items-start gap-4">
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" className={buttonStyles({ variant: 'secondary' })}>
            <ExternalLink aria-hidden />
            {t('open')}
          </a>
          <p className="max-w-[60ch] text-footnote text-ink-muted">{t('soon')}</p>
        </div>
      )}
    </div>
  );
}
