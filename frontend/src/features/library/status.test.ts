import { describe, expect, it } from 'vitest';
import { doc } from './testing';
import { matchesFilter, matchesQuery, pollInterval, statusGroup, statusView } from './status';

describe('statusView', () => {
  it('describes each stage with a tone, a text key and progress', () => {
    expect(statusView(doc({ status: 'scanning', progress: 0 }))).toEqual({
      tone: 'working',
      key: 'scanning',
      values: {},
      progress: null,
    });
    expect(statusView(doc({ status: 'queued', queue_position: 3 }))).toMatchObject({
      tone: 'neutral',
      key: 'queuedAt',
      values: { position: 3 },
    });
    expect(statusView(doc({ status: 'queued', queue_position: null })).key).toBe('queued');
    expect(statusView(doc({ status: 'parsing', progress: 0.404 }))).toEqual({
      tone: 'working',
      key: 'parsing',
      values: { percent: 40 },
      progress: 0.404,
    });
    expect(statusView(doc({ status: 'embedding', progress: 0.62 })).values).toEqual({ percent: 62 });
    expect(statusView(doc()).tone).toBe('ready');
    expect(statusView(doc({ status: 'failed', error_code: 'PDF_ENCRYPTED' })).tone).toBe('failed');
  });
});

describe('statusGroup and filters', () => {
  it('groups every status for the filter', () => {
    expect(statusGroup('ready')).toBe('ready');
    expect(statusGroup('failed')).toBe('failed');
    for (const status of ['scanning', 'queued', 'parsing', 'embedding'] as const) {
      expect(statusGroup(status)).toBe('working');
    }
  });

  it('matches filters', () => {
    expect(matchesFilter('ready', 'all')).toBe(true);
    expect(matchesFilter('working', 'working')).toBe(true);
    expect(matchesFilter('failed', 'ready')).toBe(false);
  });

  it('searches file names ignoring case and Unicode normalization', () => {
    expect(matchesQuery('Größe_Mira.pdf', 'grösse')).toBe(false);
    expect(matchesQuery('Größe_Mira.pdf', 'GRÖ')).toBe(true);
    expect(matchesQuery('Größe.pdf', 'größe')).toBe(true); // NFD from macOS
    expect(matchesQuery('Datenblatt.pdf', '  ')).toBe(true);
  });
});

describe('pollInterval', () => {
  it('polls every second only while something is in progress', () => {
    expect(pollInterval(undefined)).toBe(false);
    expect(pollInterval([doc(), doc({ status: 'failed' })])).toBe(false);
    expect(pollInterval([doc(), doc({ status: 'scanning' })])).toBe(1000);
    expect(pollInterval([doc({ status: 'embedding' })])).toBe(1000);
  });
});
