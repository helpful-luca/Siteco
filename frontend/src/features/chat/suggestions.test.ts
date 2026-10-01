import { describe, expect, it } from 'vitest';
import type { DocumentOut } from '@/shared/api/types';
import { spokenName, suggestionsFor } from './suggestions';

const doc = (id: string, filename: string, readyAt: string, status: DocumentOut['status'] = 'ready') =>
  ({ id, filename, status, in_library: true, ready_at: readyAt, created_at: readyAt }) as DocumentOut;

describe('suggestions', () => {
  it('names the newest ready document and compares when there are several', () => {
    const docs = [
      doc('a', 'Mira_L_Datenblatt.pdf', '2026-09-01T10:00:00Z'),
      doc('b', 'SIT-KAT-2026.pdf', '2026-09-30T10:00:00Z'),
      doc('c', 'Neu.pdf', '2026-10-01T10:00:00Z', 'parsing'),
    ];
    expect(suggestionsFor(docs)).toEqual([{ key: 'summaryOf', name: 'SIT KAT 2026' }, { key: 'specs' }, { key: 'compare' }]);
    expect(suggestionsFor(docs.slice(0, 1))).toEqual([
      { key: 'summaryOf', name: 'Mira L Datenblatt' },
      { key: 'specs' },
      { key: 'norms' },
    ]);
    expect(suggestionsFor([])).toEqual([]);
  });

  it('shortens long names', () => {
    expect(spokenName('SIT_KAT_Beleuchtungsloesungen_DE_2026_final_mit_allen.pdf')).toBe('SIT KAT Beleuchtungsloesungen DE 20…');
  });
});
