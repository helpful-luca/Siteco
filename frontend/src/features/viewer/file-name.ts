// Windows refuses these as file names, also with any extension (NUL.txt, nul.tar.gz).
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * A download name from a chat title (annex 10, M8): no path or reserved characters, at most 80
 * characters, no trailing dots or spaces and no name Windows reserves.
 */
export function downloadName(title: string | null | undefined, fallback: string, extension: string): string {
  let name = (title ?? '')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+/, '')
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  const dot = name.indexOf('.');
  const base = dot === -1 ? name : name.slice(0, dot);
  if (RESERVED.test(base)) name = `${base}_${name.slice(base.length)}`;
  return `${name || fallback}.${extension}`;
}
