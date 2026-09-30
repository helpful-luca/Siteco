/** Test data for the library feature. Only imported by tests. */
import type { DocumentOut } from '@/shared/api/types';

export function doc(patch: Partial<DocumentOut> = {}): DocumentOut {
  return {
    id: 'd1',
    filename: 'Mira_L_Datenblatt.pdf',
    kind: 'pdf',
    size_bytes: 1_200_000,
    page_count: 12,
    chunk_count: 30,
    status: 'ready',
    progress: 1,
    queue_position: null,
    error_code: null,
    error_params: {},
    notices: [],
    created_at: '2026-09-30T10:00:00Z',
    ready_at: '2026-09-30T10:00:05Z',
    ...patch,
  };
}
