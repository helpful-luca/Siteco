'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/shared/api/client';
import { clientError, isAbortError, normalizeError } from '@/shared/api/errors';
import type { ReadyOut, WorkspaceOut } from '@/shared/api/types';

export const WORKSPACE_KEY = ['workspace'] as const;

export function useWorkspace() {
  return useQuery({
    queryKey: WORKSPACE_KEY,
    queryFn: () => fetchJson<WorkspaceOut>('/api/workspace'),
    refetchOnWindowFocus: true,
  });
}

/** Same query as the startup gate, read again for the status in Info. */
export function useReady() {
  return useQuery({
    queryKey: ['health', 'ready'],
    queryFn: () => fetchJson<ReadyOut>('/api/health/ready'),
    retry: false,
  });
}

/** Deletes everything; afterwards every list in the app loads again (empty). */
export function useDeleteEverything() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (resetPreferences: boolean) =>
      fetchJson<void>(`/api/workspace${resetPreferences ? '?reset_preferences=true' : ''}`, { method: 'DELETE' }),
    onSettled: () => client.invalidateQueries(),
  });
}

/** Fetches the ZIP with the app's header (the proxy refuses foreign pages) and saves it. */
export async function downloadExport(): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/workspace/export', { headers: { 'X-Requested-With': 'docchat' }, cache: 'no-store' });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw clientError('NETWORK_ERROR');
  }
  if (!res.ok) throw await normalizeError(res);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'export.zip';
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers read the blob after click() returns; ten seconds is plenty for a local file.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
