/**
 * Citation markers in the answer text (annex 11, 8.4). The backend reports where a chip goes as a
 * `char_offset`; we insert a sentinel there, parse the markdown once and a remark plugin turns the
 * sentinels into chips. Sentinels use characters a model does not write: ⟦c:N⟧.
 */

import { utf16Index } from '@/shared/lib/code-points';

export const SENTINEL_PATTERN = /⟦c:(\d+)⟧/g;

/**
 * The answer may quote a document that contains sentinel-like text. Every bracket that is not ours
 * gets an invisible word joiner behind it, so it renders the same but can never form a chip.
 */
const OPEN = '⟦';
const NEUTRAL = '⟦\u2060';
const neutralize = (text: string) => text.replaceAll(OPEN, NEUTRAL);

export type ChipMark = { offset: number; n: number };

const sentinel = (n: number) => `⟦c:${n}⟧`;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Character ranges [start, end] of fenced code blocks, fences included. */
function codeRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let position = 0;
  let open: { start: number; char: string; length: number } | null = null;
  for (const line of text.split('\n')) {
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      if (!open) open = { start: position, char: marker[0], length: marker.length };
      else if (marker[0] === open.char && marker.length >= open.length && line.trim() === marker) {
        ranges.push([open.start, position + line.length]);
        open = null;
      }
    }
    position += line.length + 1;
  }
  if (open) ranges.push([open.start, text.length]);
  return ranges;
}

/** Where a chip really goes: after the last visible character, inside the last table cell. */
function settle(text: string, index: number): number {
  let i = index;
  while (i > 0 && /\s/.test(text[i - 1])) i -= 1;
  const lineStart = text.lastIndexOf('\n', i - 1) + 1;
  if (i > 0 && text[i - 1] === '|' && /^ {0,3}\|/.test(text.slice(lineStart))) {
    i -= 1;
    while (i > lineStart && text[i - 1] === ' ') i -= 1;
  }
  return i;
}

export function insertSentinels(text: string, marks: ChipMark[]): string {
  const code = codeRanges(text);
  const byPosition = new Map<number, Set<number>>();
  for (const mark of marks) {
    const position = settle(text, utf16Index(text, Math.max(0, mark.offset)));
    if (code.some(([start, end]) => position >= start && position <= end)) continue;
    const numbers = byPosition.get(position) ?? new Set<number>();
    numbers.add(mark.n);
    byPosition.set(position, numbers);
  }
  // Slices of the original text (neutralized one by one, so offsets stay valid) and our runs.
  let result = '';
  let last = 0;
  for (const position of [...byPosition.keys()].sort((a, b) => a - b)) {
    const run = [...(byPosition.get(position) ?? [])].sort((a, b) => a - b).map(sentinel).join('');
    result += neutralize(text.slice(last, position)) + run;
    last = position;
  }
  return result + neutralize(text.slice(last));
}

/** Plain text again: our sentinels removed, neutralized brackets restored. */
export function stripSentinels(text: string): string {
  return text.replace(SENTINEL_PATTERN, '').replaceAll(NEUTRAL, OPEN);
}
