import { describe, expect, it } from 'vitest';
import { DEFAULT_WINDOW, restoreBounds } from '../../src/window-state';

const laptop = { x: 0, y: 0, width: 1512, height: 944 };
const external = { x: 1512, y: -200, width: 2560, height: 1415 };

describe('restoreBounds', () => {
  it('uses the default size, centred, without saved bounds', () => {
    expect(restoreBounds(undefined, [laptop])).toEqual({ width: DEFAULT_WINDOW.width, height: DEFAULT_WINDOW.height });
  });

  it('keeps saved bounds that are visible on a display', () => {
    const saved = { x: 1600, y: 0, width: 1400, height: 900 };
    expect(restoreBounds(saved, [laptop, external])).toEqual(saved);
  });

  it('drops the position when its display is gone, keeps the size', () => {
    const saved = { x: 1600, y: 0, width: 1400, height: 900 };
    expect(restoreBounds(saved, [laptop])).toEqual({ width: 1400, height: 900 });
  });

  it('shrinks a window that is larger than every display', () => {
    const saved = { width: 4000, height: 3000 };
    expect(restoreBounds(saved, [laptop])).toEqual({ width: 1512, height: 944 });
  });

  it('carries the maximized flag', () => {
    const saved = { x: 10, y: 10, width: 1000, height: 700, maximized: true };
    expect(restoreBounds(saved, [laptop])).toEqual(saved);
  });

  it('needs a real overlap, not a sliver', () => {
    const saved = { x: 1500, y: 0, width: 1000, height: 700 };
    expect(restoreBounds(saved, [laptop])).toEqual({ width: 1000, height: 700 });
  });
});
