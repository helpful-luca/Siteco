import { describe, expect, it } from 'vitest';
import { clampSidebarWidth, parseSidebarLayout, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from './sidebar-layout';

describe('sidebar layout', () => {
  it('reads the cookies and falls back to the defaults', () => {
    expect(parseSidebarLayout()).toEqual({ collapsed: false, width: SIDEBAR_DEFAULT });
    expect(parseSidebarLayout('collapsed', '300')).toEqual({ collapsed: true, width: 300 });
    expect(parseSidebarLayout('open', '9000')).toEqual({ collapsed: false, width: SIDEBAR_DEFAULT });
    expect(parseSidebarLayout(undefined, '12px')).toEqual({ collapsed: false, width: SIDEBAR_DEFAULT });
  });

  it('keeps the width within its bounds', () => {
    expect(clampSidebarWidth(100)).toBe(SIDEBAR_MIN);
    expect(clampSidebarWidth(999)).toBe(SIDEBAR_MAX);
    expect(clampSidebarWidth(250.6)).toBe(251);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT);
  });
});
