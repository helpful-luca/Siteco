import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/shared/api/client';
import { clientError, normalizeError } from '@/shared/api/errors';
import type { ChunkOut } from '@/shared/api/types';

export const fileUrl = (documentId: string) => `/api/documents/${documentId}/file`;

/** The cited chunk with its sentences and line rectangles. Immutable, so it is cached for good. */
export function useChunk(documentId: string, chunkId: string, enabled = true) {
  return useQuery({
    queryKey: ['chunk', documentId, chunkId],
    queryFn: ({ signal }) => fetchJson<ChunkOut>(`/api/documents/${documentId}/chunks/${chunkId}`, { signal }),
    enabled,
    staleTime: Infinity,
  });
}

async function fetchText(documentId: string, signal: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`/api/documents/${documentId}/text`, { signal, headers: { 'X-Requested-With': 'docchat' } });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw clientError('NETWORK_ERROR');
  }
  if (!res.ok) throw await normalizeError(res);
  return res.text();
}

/** The normalized text of a TXT/MD document; sentence offsets count in it. */
export function useDocumentText(documentId: string) {
  return useQuery({
    queryKey: ['document-text', documentId],
    queryFn: ({ signal }) => fetchText(documentId, signal),
    staleTime: Infinity,
    gcTime: 60_000,
  });
}
