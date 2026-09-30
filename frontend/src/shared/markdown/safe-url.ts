/** Links in answers may only lead to web pages or mail (master spec 10.4). Everything else is dropped. */
const ALLOWED = new Set(['http:', 'https:', 'mailto:']);

export function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    return ALLOWED.has(parsed.protocol) ? trimmed : null;
  } catch {
    return null; // relative, anchors and garbage: nothing to follow
  }
}
