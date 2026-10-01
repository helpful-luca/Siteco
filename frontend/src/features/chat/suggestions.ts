import type { DocumentOut } from '@/shared/api/types';

export type Suggestion = { key: 'summaryOf' | 'specs' | 'norms' | 'compare'; name?: string };

const MAX_NAME = 36;

/** A file name as people say it: no extension, separators as spaces, short. */
export function spokenName(filename: string): string {
  const stem = filename.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return stem.length > MAX_NAME ? `${stem.slice(0, MAX_NAME - 1).trimEnd()}…` : stem;
}

/**
 * Three starting questions about the library as it is: the newest ready document by name, its
 * technical data, and the norms, or a comparison once there are several documents.
 */
export function suggestionsFor(documents: readonly DocumentOut[]): Suggestion[] {
  const ready = documents
    .filter((d) => d.status === 'ready' && d.in_library)
    .sort((a, b) => Date.parse(b.ready_at ?? b.created_at) - Date.parse(a.ready_at ?? a.created_at));
  if (ready.length === 0) return [];
  return [
    { key: 'summaryOf', name: spokenName(ready[0].filename) },
    { key: 'specs' },
    ready.length > 1 ? { key: 'compare' } : { key: 'norms' },
  ];
}
