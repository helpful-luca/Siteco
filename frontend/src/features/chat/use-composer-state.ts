'use client';

import { isInProgress, useAttachments, useDocuments, useUploads } from '@/features/library';

export type ComposerBlock = 'noDocuments' | 'processing' | null;

/**
 * Why the composer cannot send right now (annex 10, E1, E2): no documents at all, or none ready
 * yet. A chat counts its own attachments too. Uploads in flight (into the library or this chat)
 * count as "processing". Unknown (still loading) never blocks.
 */
export function useComposerBlock(chatId: string | null = null): { block: ComposerBlock; readyCount: number } {
  const { data } = useDocuments();
  const attachments = useAttachments(chatId);
  const { items } = useUploads();
  if (!data || (chatId !== null && !attachments.data)) return { block: null, readyCount: 0 };
  const library = new Set(data.documents.map((d) => d.id));
  const documents = [
    ...data.documents,
    ...(attachments.data?.documents ?? []).filter((d) => !library.has(d.id)),
  ];
  const readyCount = documents.filter((d) => d.status === 'ready').length;
  if (readyCount > 0) return { block: null, readyCount };
  const uploading = items.some((i) => i.state !== 'failed' && (i.chatId === null || i.chatId === chatId));
  const working = documents.some((d) => isInProgress(d.status)) || uploading;
  return { block: working ? 'processing' : 'noDocuments', readyCount };
}
