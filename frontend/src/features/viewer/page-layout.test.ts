import { describe, expect, it } from 'vitest';
import { nextZoom, pageAt, pageLayout, ratiosFor, scrollTopFor, visibleRange } from './page-layout';

const A4 = 297 / 210;

describe('ratiosFor', () => {
  it('uses measured pages and estimates the others', () => {
    expect(ratiosFor(4, new Map([[2, 0.5]]), A4)).toEqual([A4, A4, 0.5, A4]);
  });
});

describe('pageLayout', () => {
  it('stacks pages with padding and gaps', () => {
    const layout = pageLayout([1, 0.5, 1], 400, { gap: 16, padding: 16 });
    expect(layout.tops).toEqual([16, 432, 648]);
    expect(layout.heights).toEqual([400, 200, 400]);
    expect(layout.total).toBe(1064);
  });

  it('handles an empty document', () => {
    expect(pageLayout([], 400, { gap: 16, padding: 16 }).total).toBe(32);
  });
});

describe('visibleRange and pageAt', () => {
  const layout = pageLayout(Array(1500).fill(1), 100, { gap: 10, padding: 10 });

  it('finds the pages in view plus overscan in a large catalog', () => {
    // Page n (0-based) starts at 10 + 110 n.
    expect(visibleRange(layout, 110 * 800, 300, 0)).toEqual([799, 802]);
    expect(visibleRange(layout, 110 * 800, 300, 200)).toEqual([798, 804]);
    expect(visibleRange(layout, 0, 300, 0)).toEqual([0, 2]);
  });

  it('names the page under a point, also inside a gap', () => {
    expect(pageAt(layout, 0)).toBe(0);
    expect(pageAt(layout, 10 + 110 * 42 + 50)).toBe(42);
    expect(pageAt(layout, 10 + 110 * 42 + 105)).toBe(42);
    expect(pageAt(layout, 10 ** 9)).toBe(1499);
  });
});

describe('scrollTopFor', () => {
  const layout = pageLayout([1, 1, 1, 1], 100, { gap: 10, padding: 10 });

  it('puts a point of a page at a share of the viewport', () => {
    expect(scrollTopFor(layout, 2, 0, 200)).toBe(230);
    expect(scrollTopFor(layout, 2, 0.5, 200, 0.25)).toBe(230);
  });

  it('never scrolls past either end', () => {
    expect(scrollTopFor(layout, 0, 0, 200, 0.5)).toBe(0);
    expect(scrollTopFor(layout, 3, 1, 200)).toBe(layout.total - 200);
  });
});

describe('nextZoom', () => {
  it('steps through the zoom levels and stops at the ends', () => {
    expect(nextZoom(1, 1)).toBe(1.25);
    expect(nextZoom(1, -1)).toBe(0.75);
    expect(nextZoom(3, 1)).toBe(3);
    expect(nextZoom(0.5, -1)).toBe(0.5);
    expect(nextZoom(1.1, 1)).toBe(1.25);
  });
});
