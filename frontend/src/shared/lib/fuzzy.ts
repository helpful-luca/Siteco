export type FuzzyMatch = { score: number; indices: number[] };

/**
 * One entry per character (code point), lower case without accents. Indices into this array are
 * character indices, the same ones the highlight counts (`[...text]`), so emoji and other
 * characters outside the basic plane never shift a match.
 */
function fold(text: string): string[] {
  return [...text].map((char) => String.fromCodePoint(char.normalize('NFD').codePointAt(0)!).toLocaleLowerCase());
}

const isWordStart = (chars: string[], index: number) => index === 0 || /[\s._\-/(]/.test(chars[index - 1]);

function occursAt(hay: string[], needle: string[], at: number): boolean {
  return needle.every((char, i) => hay[at + i] === char);
}

/**
 * Command palette matching: every query character in order. A contiguous run beats scattered
 * letters, a match at a word start beats one inside a word, the text's start beats both. Returns
 * the matched character indices for highlighting, or null.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const needle = fold(query.trim());
  if (needle.length === 0) return { score: 0, indices: [] };
  const hay = fold(text);

  // A contiguous occurrence wins outright; the earliest word start among them is best.
  let contiguous = -1;
  for (let at = 0; at + needle.length <= hay.length; at += 1) {
    if (!occursAt(hay, needle, at)) continue;
    if (contiguous === -1 || (isWordStart(hay, at) && !isWordStart(hay, contiguous))) contiguous = at;
    if (isWordStart(hay, at)) break;
  }
  if (contiguous !== -1) {
    const indices = Array.from({ length: needle.length }, (_, i) => contiguous + i);
    const bonus = contiguous === 0 ? 300 : isWordStart(hay, contiguous) ? 200 : 100;
    return { score: bonus + needle.length * 10 - contiguous, indices };
  }

  const indices: number[] = [];
  let score = 0;
  let from = 0;
  for (const char of needle) {
    const at = hay.indexOf(char, from);
    if (at === -1) return null;
    score += isWordStart(hay, at) ? 8 : indices.at(-1) === at - 1 ? 5 : 1;
    indices.push(at);
    from = at + 1;
  }
  return { score: score - indices[0] / 10, indices };
}
