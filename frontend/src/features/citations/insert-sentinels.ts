/**
 * Citation markers in the answer text (annex 11, 8.4). The backend reports where a chip goes as a
 * `char_offset`; we insert a sentinel there, parse the markdown once and a remark plugin turns the
 * sentinels into chips. Sentinels use characters a model does not write: ⟦c:N⟧.
 */

export const SENTINEL_PATTERN = /⟦c:(\d+)⟧/g;

export type ChipMark = { offset: number; n: number };

const sentinel = (n: number) => `⟦c:${n}⟧`;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Python counts code points, JavaScript strings count UTF-16 units. */
function toIndex(text: string, codePoints: number): number {
  let index = 0;
  let seen = 0;
  while (index < text.length && seen < codePoints) {
    const code = text.codePointAt(index) ?? 0;
    index += code > 0xffff ? 2 : 1;
    seen += 1;
  }
  return index;
}

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
    const position = settle(text, toIndex(text, Math.max(0, mark.offset)));
    if (code.some(([start, end]) => position >= start && position <= end)) continue;
    const numbers = byPosition.get(position) ?? new Set<number>();
    numbers.add(mark.n);
    byPosition.set(position, numbers);
  }
  let result = text;
  for (const position of [...byPosition.keys()].sort((a, b) => b - a)) {
    const run = [...(byPosition.get(position) ?? [])].sort((a, b) => a - b).map(sentinel).join('');
    result = result.slice(0, position) + run + result.slice(position);
  }
  return result;
}

export function stripSentinels(text: string): string {
  return text.replace(SENTINEL_PATTERN, '');
}
