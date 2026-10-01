import type { CSSProperties } from 'react';
import type { ChunkOut, CitationOut } from '@/shared/api/types';

/** (x, y, width, height) in 0..1 of the page as displayed, origin top left. */
export type Rect = [number, number, number, number];

export type Highlight = {
  /** True when `rects` mark exactly the cited sentences; false means the fallback path. */
  exact: boolean;
  rects: Rect[];
};

/**
 * Sentence indexes of one source that the answer cites. Each chunk sentence is one citable block
 * (`block_start..block_end`, end exclusive), so blocks and sentence indexes are the same numbers.
 */
export function citedSentences(citations: CitationOut[], sourceId: string): number[] {
  const indexes = new Set<number>();
  for (const citation of citations) {
    if (citation.source_id !== sourceId) continue;
    for (let i = citation.block_start; i < citation.block_end; i += 1) indexes.add(i);
  }
  return [...indexes].sort((a, b) => a - b);
}

/**
 * The rectangles to light up. Without cited sentences (a passage that was only retrieved) the whole
 * chunk is the passage. Wrong rectangles are worse than none: if the page has no precise geometry
 * or a cited sentence has no rectangle, the viewer takes the fallback path instead.
 */
export function highlightFor(chunk: ChunkOut, sentences: number[]): Highlight {
  const wanted = new Set(sentences);
  const selected = wanted.size ? chunk.sentences.filter((s) => wanted.has(s.i)) : chunk.sentences;
  if (!chunk.precise_highlight || selected.length === 0 || selected.some((s) => s.rects.length === 0)) {
    return { exact: false, rects: [] };
  }
  return { exact: true, rects: selected.flatMap((s) => s.rects.map((r) => [...r] as Rect)) };
}

// pdfium line boxes hug the glyphs; a marker stroke reaches a little above and below.
const PAD_Y = 0.15;
const PAD_X = 0.002;

const percent = (value: number) => `${Math.round(value * 10000) / 100}%`;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Position of a mark over the page, in percent, so it follows any page width and zoom. */
export function markStyle([x, y, w, h]: Rect): CSSProperties {
  const left = clamp(x - PAD_X);
  const top = clamp(y - h * PAD_Y);
  const right = clamp(x + w + PAD_X);
  const bottom = clamp(y + h * (1 + PAD_Y));
  return { left: percent(left), top: percent(top), width: percent(right - left), height: percent(bottom - top) };
}
