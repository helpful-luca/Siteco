'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { ApiError, fetchJson } from '@/shared/api/client';
import type { DocumentEnvelopeOut, DocumentListOut, DocumentOut } from '@/shared/api/types';
import { pollInterval } from './status';

export const DOCUMENTS_KEY = ['documents'] as const;

export function useDocuments() {
  return useQuery({
    queryKey: DOCUMENTS_KEY,
    queryFn: () => fetchJson<DocumentListOut>('/api/documents'),
    refetchInterval: (query) => pollInterval(query.state.data?.documents),
    refetchOnWindowFocus: true, // a delete in another tab shows up when coming back
  });
}

/** Puts a freshly uploaded document into the list at once, before the next poll. */
export function useAddDocumentToList() {
  const client = useQueryClient();
  return useCallback(
    (document: DocumentOut) => {
      client.setQueryData<DocumentListOut>(DOCUMENTS_KEY, (current) => ({
        documents: [document, ...(current?.documents ?? []).filter((d) => d.id !== document.id)],
      }));
      void client.invalidateQueries({ queryKey: DOCUMENTS_KEY });
    },
    [client],
  );
}

export function useDeleteDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        await fetchJson<unknown>(`/api/documents/${id}`, { method: 'DELETE' });
      } catch (error) {
        // Already gone (double click, other tab): the goal is reached (annex 10, D11).
        if (!(error instanceof ApiError && error.code === 'NOT_FOUND')) throw error;
      }
    },
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: DOCUMENTS_KEY });
      const previous = client.getQueryData<DocumentListOut>(DOCUMENTS_KEY);
      client.setQueryData<DocumentListOut>(DOCUMENTS_KEY, (current) =>
        current ? { documents: current.documents.filter((d) => d.id !== id) } : current,
      );
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) client.setQueryData(DOCUMENTS_KEY, context.previous);
    },
    onSettled: () => {
      // Answers that cited the document now show it as deleted, without its text.
      void client.invalidateQueries({ queryKey: ['messages'] });
      return client.invalidateQueries({ queryKey: DOCUMENTS_KEY });
    },
  });
}

export const attachmentsKey = (chatId: string) => ['attachments', chatId] as const;

/** Documents uploaded into one chat (not listed in the library unless moved there). */
export function useAttachments(chatId: string | null) {
  return useQuery({
    queryKey: attachmentsKey(chatId ?? ''),
    queryFn: () => fetchJson<DocumentListOut>(`/api/chats/${chatId}/attachments`),
    enabled: chatId !== null,
    refetchInterval: (query) => pollInterval(query.state.data?.documents),
    refetchOnWindowFocus: true,
  });
}

/** Puts a freshly uploaded attachment into its chat's list at once, before the next poll. */
export function useAddAttachmentToList() {
  const client = useQueryClient();
  return useCallback(
    (chatId: string, document: DocumentOut) => {
      client.setQueryData<DocumentListOut>(attachmentsKey(chatId), (current) => ({
        documents: [document, ...(current?.documents ?? []).filter((d) => d.id !== document.id)],
      }));
      void client.invalidateQueries({ queryKey: attachmentsKey(chatId) });
    },
    [client],
  );
}

/** An attachment moves into the library: listed there and searched by every chat in scope. */
export function useAddToLibrary() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) =>
      fetchJson<DocumentEnvelopeOut>(`/api/documents/${documentId}/library`, { method: 'POST' }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['attachments'] });
      return client.invalidateQueries({ queryKey: DOCUMENTS_KEY });
    },
  });
}

/** Removes a document from the chat; one held nowhere else is deleted on the server. */
export function useRemoveAttachment() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ chatId, documentId }: { chatId: string; documentId: string }) => {
      try {
        await fetchJson<unknown>(`/api/chats/${chatId}/attachments/${documentId}`, { method: 'DELETE' });
      } catch (error) {
        if (!(error instanceof ApiError && error.code === 'NOT_FOUND')) throw error;
      }
    },
    onMutate: async ({ chatId, documentId }) => {
      await client.cancelQueries({ queryKey: attachmentsKey(chatId) });
      client.setQueryData<DocumentListOut>(attachmentsKey(chatId), (current) =>
        current ? { documents: current.documents.filter((d) => d.id !== documentId) } : current,
      );
    },
    onSettled: (_data, _error, { chatId }) => {
      void client.invalidateQueries({ queryKey: ['messages'] });
      void client.invalidateQueries({ queryKey: DOCUMENTS_KEY });
      return client.invalidateQueries({ queryKey: attachmentsKey(chatId) });
    },
  });
}
