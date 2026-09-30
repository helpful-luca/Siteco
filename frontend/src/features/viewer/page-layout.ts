/**
 * Geometry of the virtualized page column. Pure, so it is tested without a browser: a 1500-page
 * catalog is a list of heights, and only the pages near the viewport mount a PDF.js page.
 */

export type Layout = {
  /** Top edge of each page in the scroll content, in px. */
  tops: number[];
  heights: number[];
  total: number;
  width: number;
};

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

/** Height/width per page: measured where known, else the estimate (usually the cited page's). */
export function ratiosFor(count: number, measured: ReadonlyMap<number, number>, estimate: number): number[] {
  return Array.from({ length: count }, (_, index) => measured.get(index) ?? estimate);
}

export function pageLayout(ratios: number[], width: number, spacing: { gap: number; padding: number }): Layout {
  const tops: number[] = [];
  const heights: number[] = [];
  let y = spacing.padding;
  ratios.forEach((ratio, index) => {
    if (index > 0) y += spacing.gap;
    tops.push(y);
    const height = Math.round(width * ratio);
    heights.push(height);
    y += height;
  });
  return { tops, heights, total: y + spacing.padding, width };
}

/** Index of the page under y (a gap belongs to the page above it). */
export function pageAt(layout: Layout, y: number): number {
  let low = 0;
  let high = layout.tops.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (layout.tops[middle] <= y) low = middle;
    else high = middle - 1;
  }
  return Math.max(0, low);
}

/** First and last page index (inclusive) that intersect the viewport extended by `overscan` px. */
export function visibleRange(layout: Layout, scrollTop: number, viewport: number, overscan: number): [number, number] {
  const first = pageAt(layout, Math.max(0, scrollTop - overscan));
  const top = layout.tops[first] ?? 0;
  const firstVisible = top + (layout.heights[first] ?? 0) < scrollTop - overscan ? first + 1 : first;
  const last = pageAt(layout, scrollTop + viewport + overscan);
  return [Math.min(firstVisible, last), last];
}

/**
 * Scroll position that puts `fraction` (0..1 down the page) of page `index` at `focus` (0..1 down
 * the viewport), clamped to the scrollable range.
 */
export function scrollTopFor(layout: Layout, index: number, fraction: number, viewport: number, focus = 0): number {
  const y = (layout.tops[index] ?? 0) + fraction * (layout.heights[index] ?? 0) - focus * viewport;
  return Math.round(Math.min(Math.max(0, layout.total - viewport), Math.max(0, y)));
}

/** The next zoom level up (1) or down (-1) from any current zoom. */
export function nextZoom(zoom: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((step) => step > zoom + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - 1e-6) ?? ZOOM_STEPS[0];
}
