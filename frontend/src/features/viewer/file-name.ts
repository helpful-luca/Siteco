/** A download name from a chat title: no path or reserved characters, at most 80 characters (annex 10, M8). */
export function downloadName(title: string | null | undefined, fallback: string, extension: string): string {
  const cleaned = (title ?? '')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return `${cleaned || fallback}.${extension}`;
}
