/**
 * Fallback highlight (annex 10, L4): when a page has no precise sentence geometry, the chunk's text
 * is looked up in PDF.js's own text layer of that page and those text items are marked.
 * Comparison ignores whitespace and hyphens, which differ between pdfium and PDF.js.
 */

const IGNORED = /[\s\-­‐‑]/u;
// Long enough to be unambiguous on a page, short enough to survive a small difference in between.
const ANCHOR = 32;

function squeeze(items: string[]): { text: string; owner: number[] } {
  let text = '';
  const owner: number[] = [];
  items.forEach((item, index) => {
    for (const char of item) {
      if (IGNORED.test(char)) continue;
      text += char;
      for (let i = 0; i < char.length; i += 1) owner.push(index);
    }
  });
  return { text, owner };
}

const squeezeText = (value: string) => [...value].filter((char) => !IGNORED.test(char)).join('');

/** Indexes of the text items that carry `passage`, or an empty set if it is not found. */
export function matchTextItems(items: string[], passage: string): Set<number> {
  const needle = squeezeText(passage);
  if (!needle) return new Set();
  const { text, owner } = squeeze(items);
  let start = text.indexOf(needle);
  let end = start + needle.length;
  if (start < 0) {
    start = text.indexOf(needle.slice(0, ANCHOR));
    const tail = needle.slice(-ANCHOR);
    const tailAt = start < 0 ? -1 : text.indexOf(tail, start);
    if (start < 0 || tailAt < 0) return new Set();
    end = tailAt + tail.length;
  }
  return new Set(owner.slice(start, end));
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Document text is untrusted: the text layer renderer takes HTML, so everything is escaped. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ENTITIES[char]);
}
