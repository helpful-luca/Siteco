'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useUI } from '@/features/shell';
import type { CitationOut, DocumentOut, SourceOut } from '@/shared/api/types';
import { DocumentPreview } from './document-preview';
import { citedSentences } from './highlight';
import { PageIndicator } from './page-indicator';
import { createPageStore } from './page-store';
import { SourceView } from './source-view';

/** What a chip or a sources row points at: one source of one answer. */
export type SourceRef = {
  messageKey: string;
  source: SourceOut;
  citedText: string | null;
  /** The answer's citations; the ones of this source name the sentences to mark. */
  citations?: CitationOut[];
};

export const sourcePanelId = (messageKey: string, sourceId: string) => `source:${messageKey}:${sourceId}`;

/**
 * The entry point for citation clicks: opens the source in the right panel, the PDF on the cited
 * page with the sentence marked (wide panel, so a page is readable), text files at the passage.
 */
export function useOpenSource() {
  const { openPanel } = useUI();
  const t = useTranslations('viewer.source');
  return useCallback(
    ({ messageKey, source, citedText, citations = [] }: SourceRef) => {
      const pdf = source.page !== null;
      const store = createPageStore({ page: source.page ?? 1, pages: null });
      const where = pdf ? t('page', { page: source.page ?? 1 }) : t('passage');
      openPanel({
        id: sourcePanelId(messageKey, source.id),
        title: source.filename,
        subtitle: pdf && !source.deleted ? <PageIndicator store={store} /> : where,
        size: pdf && !source.deleted ? 'wide' : 'default',
        body: (
          <SourceView
            source={source}
            citedText={citedText}
            sentences={citedSentences(citations, source.id)}
            store={store}
          />
        ),
      });
    },
    [openPanel, t],
  );
}

/** The library's "Vorschau": the document without a highlight. The panel id is the document id. */
export function useOpenDocument() {
  const { openPanel } = useUI();
  const t = useTranslations('viewer.source');
  return useCallback(
    (document: DocumentOut) => {
      const pdf = document.kind === 'pdf';
      const store = createPageStore({ page: 1, pages: document.page_count });
      openPanel({
        id: document.id,
        title: document.filename,
        subtitle: pdf ? <PageIndicator store={store} /> : t('textFile'),
        size: pdf ? 'wide' : 'default',
        body: <DocumentPreview document={document} store={store} />,
      });
    },
    [openPanel, t],
  );
}

/** The source id shown in the panel for this answer, to light up its chip. */
export function useActiveSourceId(messageKey: string): string | null {
  const { panel } = useUI();
  const prefix = `source:${messageKey}:`;
  return panel?.id.startsWith(prefix) ? panel.id.slice(prefix.length) : null;
}
