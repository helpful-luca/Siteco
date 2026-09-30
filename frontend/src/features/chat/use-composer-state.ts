'use client';

import { isInProgress, useDocuments, useUploads } from '@/features/library';

export type ComposerBlock = 'noDocuments' | 'processing' | null;

/**
 * Why the composer cannot send right now (annex 10, E1, E2): no documents at all, or none ready
 * yet. Uploads in flight count as "processing". Unknown (still loading) never blocks.
 */
export function useComposerBlock(): { block: ComposerBlock; readyCount: number } {
  const { data } = useDocuments();
  const { items } = useUploads();
  if (!data) return { block: null, readyCount: 0 };
  const documents = data.documents;
  const readyCount = documents.filter((d) => d.status === 'ready').length;
  if (readyCount > 0) return { block: null, readyCount };
  const working = documents.some((d) => isInProgress(d.status)) || items.some((i) => i.state !== 'failed');
  return { block: working ? 'processing' : 'noDocuments', readyCount };
}
