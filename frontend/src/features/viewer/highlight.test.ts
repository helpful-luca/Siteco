import { describe, expect, it } from 'vitest';
import type { ChunkOut, CitationOut } from '@/shared/api/types';
import { citedSentences, highlightFor, markStyle } from './highlight';

const citation = (source_id: string, block_start: number, block_end: number): CitationOut => ({
  source_id,
  block_start,
  block_end,
  char_offset: 0,
  cited_text: '',
});

const chunk = (patch: Partial<ChunkOut> = {}): ChunkOut => ({
  chunk_id: 'c1',
  page: 4,
  precise_highlight: true,
  text: 'Erster Satz. Zweiter Satz. Dritter Satz.',
  sentences: [
    { i: 0, text: 'Erster Satz.', char_start: 0, char_end: 12, rects: [[0.1, 0.2, 0.3, 0.02]] },
    {
      i: 1,
      text: 'Zweiter Satz.',
      char_start: 13,
      char_end: 26,
      rects: [
        [0.45, 0.2, 0.4, 0.02],
        [0.1, 0.23, 0.2, 0.02],
      ],
    },
    { i: 2, text: 'Dritter Satz.', char_start: 27, char_end: 40, rects: [[0.35, 0.23, 0.3, 0.02]] },
  ],
  ...patch,
});

describe('citedSentences', () => {
  it('collects the cited blocks of one source, each once and in order', () => {
    const citations = [citation('a', 1, 3), citation('b', 0, 1), citation('a', 0, 2)];
    expect(citedSentences(citations, 'a')).toEqual([0, 1, 2]);
    expect(citedSentences(citations, 'c')).toEqual([]);
  });
});

describe('highlightFor', () => {
  it('returns the line rectangles of the cited sentences', () => {
    expect(highlightFor(chunk(), [1])).toEqual({
      exact: true,
      rects: [
        [0.45, 0.2, 0.4, 0.02],
        [0.1, 0.23, 0.2, 0.02],
      ],
    });
  });

  it('marks the whole chunk when nothing specific was cited', () => {
    expect(highlightFor(chunk(), []).rects).toHaveLength(4);
  });

  it('ignores block indexes the chunk does not have', () => {
    expect(highlightFor(chunk(), [2, 9]).rects).toEqual([[0.35, 0.23, 0.3, 0.02]]);
  });

  it('falls back when the page has no precise geometry', () => {
    expect(highlightFor(chunk({ precise_highlight: false }), [1])).toEqual({ exact: false, rects: [] });
  });

  it('falls back when a cited sentence has no rectangles', () => {
    const broken = chunk();
    broken.sentences[1] = { ...broken.sentences[1], rects: [] };
    expect(highlightFor(broken, [0, 1]).exact).toBe(false);
  });
});

describe('markStyle', () => {
  it('maps a normalized rectangle to percentages with a little room above and below', () => {
    expect(markStyle([0.1, 0.2, 0.3, 0.02])).toEqual({
      left: '9.8%',
      top: '19.7%',
      width: '30.4%',
      height: '2.6%',
    });
  });

  it('stays inside the page', () => {
    expect(markStyle([0, 0, 1, 0.02])).toMatchObject({ left: '0%', top: '0%', width: '100%' });
  });
});
