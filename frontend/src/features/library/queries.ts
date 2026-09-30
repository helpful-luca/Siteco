'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { ApiError, fetchJson } from '@/shared/api/client';
import type { DocumentListOut, DocumentOut } from '@/shared/api/types';
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
