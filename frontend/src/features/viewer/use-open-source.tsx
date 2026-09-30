'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { useUI } from '@/features/shell';
import type { SourceOut } from '@/shared/api/types';
import { SourceView } from './source-view';

/** What a chip or a sources row points at: one source of one answer. */
export type SourceRef = { messageKey: string; source: SourceOut; citedText: string | null };

export const sourcePanelId = (messageKey: string, sourceId: string) => `source:${messageKey}:${sourceId}`;

/** The seam for citation clicks: opens the source in the right panel (WP-E: PDF highlight). */
export function useOpenSource() {
  const { openPanel } = useUI();
  const t = useTranslations('viewer.source');
  return useCallback(
    ({ messageKey, source, citedText }: SourceRef) =>
      openPanel({
        id: sourcePanelId(messageKey, source.id),
        title: source.filename,
        subtitle: source.page !== null ? t('page', { page: source.page }) : t('passage'),
        body: <SourceView source={source} citedText={citedText} />,
      }),
    [openPanel, t],
  );
}

/** The source id shown in the panel for this answer, to light up its chip. */
export function useActiveSourceId(messageKey: string): string | null {
  const { panel } = useUI();
  const prefix = `source:${messageKey}:`;
  return panel?.id.startsWith(prefix) ? panel.id.slice(prefix.length) : null;
}
