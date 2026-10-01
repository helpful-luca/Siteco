export type FuzzyMatch = { score: number; indices: number[] };

/** Lower case without accents, one code unit per character so indices map back to the text. */
function fold(text: string): string {
  return [...text].map((char) => char.normalize('NFD')[0].toLocaleLowerCase()).join('');
}

const isWordStart = (text: string, index: number) => index === 0 || /[\s._\-/(]/.test(text[index - 1]);

/**
 * Command palette matching: every query character in order. A contiguous run beats scattered
 * letters, a match at a word start beats one inside a word, the text's start beats both. Returns
 * the matched indices for highlighting, or null.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const needle = fold(query.trim());
  if (!needle) return { score: 0, indices: [] };
  const hay = fold(text);
  if (hay.length !== text.length) return null; // unusual characters: no reliable highlight

  // A contiguous occurrence wins outright; the earliest word start among them is best.
  let contiguous = -1;
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
    if (contiguous === -1 || (isWordStart(text, at) && !isWordStart(text, contiguous))) contiguous = at;
    if (isWordStart(text, at)) break;
  }
  if (contiguous !== -1) {
    const indices = Array.from({ length: needle.length }, (_, i) => contiguous + i);
    const bonus = contiguous === 0 ? 300 : isWordStart(text, contiguous) ? 200 : 100;
    return { score: bonus + needle.length * 10 - contiguous, indices };
  }

  const indices: number[] = [];
  let score = 0;
  let from = 0;
  for (const char of needle) {
    const at = hay.indexOf(char, from);
    if (at === -1) return null;
    score += isWordStart(text, at) ? 8 : indices.at(-1) === at - 1 ? 5 : 1;
    indices.push(at);
    from = at + 1;
  }
  return { score: score - indices[0] / 10, indices };
}
