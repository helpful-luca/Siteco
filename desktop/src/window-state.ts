import type { WindowBounds } from './config';

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_WINDOW = { width: 1360, height: 880, minWidth: 900, minHeight: 600 } as const;

/** A window counts as visible when this much of it overlaps a display (title bar reachable). */
const MIN_VISIBLE = 120;

function overlap(a: Area, b: Area): { width: number; height: number } {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return { width: Math.max(0, width), height: Math.max(0, height) };
}

/**
 * Restores the saved bounds when they are still on a display (work areas). A monitor that is
 * gone drops the position, so macOS centres the window; the size never exceeds the largest display.
 */
export function restoreBounds(saved: WindowBounds | undefined, workAreas: Area[]): WindowBounds {
  if (!saved) return { width: DEFAULT_WINDOW.width, height: DEFAULT_WINDOW.height };
  const maxWidth = Math.max(...workAreas.map((a) => a.width), DEFAULT_WINDOW.minWidth);
  const maxHeight = Math.max(...workAreas.map((a) => a.height), DEFAULT_WINDOW.minHeight);
  const bounds: WindowBounds = {
    width: Math.min(Math.max(saved.width, DEFAULT_WINDOW.minWidth), maxWidth),
    height: Math.min(Math.max(saved.height, DEFAULT_WINDOW.minHeight), maxHeight),
  };
  if (saved.x !== undefined && saved.y !== undefined) {
    const rect = { x: saved.x, y: saved.y, width: bounds.width, height: bounds.height };
    const visible = workAreas.some((area) => {
      const o = overlap(rect, area);
      return o.width >= MIN_VISIBLE && o.height >= MIN_VISIBLE;
    });
    if (visible) {
      bounds.x = saved.x;
      bounds.y = saved.y;
    }
  }
  if (saved.maximized) bounds.maximized = true;
  return bounds;
}
