/** Height of the top fade once the list is scrolled (macOS scroll edge under the header). */
const TOP_FADE = 40;
/** The list fades out over this distance and is gone where the composer begins. */
export const BOTTOM_FADE = 32;

/**
 * Mask for the chat list: text fades out just above the floating composer (and under the header
 * once scrolled) instead of running behind the glass, where the blur would turn it into a glow.
 */
export function scrollEdgeMask({ scrolled, dockHeight }: { scrolled: boolean; dockHeight: number }): string {
  const top = scrolled ? `transparent 0px, black ${TOP_FADE}px` : 'black 0px';
  const solidUntil = dockHeight + BOTTOM_FADE;
  return `linear-gradient(to bottom, ${top}, black calc(100% - ${solidUntil}px), transparent calc(100% - ${dockHeight}px))`;
}
