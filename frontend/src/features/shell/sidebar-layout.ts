/** Sidebar state that survives a reload: collapsed to the rail, and its width (cookies, no flash). */
export const SIDEBAR_COOKIE = 'sidebar';
export const SIDEBAR_WIDTH_COOKIE = 'sidebar-width';

export const SIDEBAR_DEFAULT = 264;
export const SIDEBAR_MIN = 224;
export const SIDEBAR_MAX = 360;
/** The collapsed rail: 32 px buttons inside the sidebar's 12 px padding. */
export const SIDEBAR_RAIL = 56;

export type SidebarLayout = { collapsed: boolean; width: number };

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT;
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));
}

/** Allowlist parser for the two cookies: anything odd is the default. */
export function parseSidebarLayout(collapsed?: string, width?: string): SidebarLayout {
  const parsed = width && /^\d{3}$/.test(width) ? Number(width) : SIDEBAR_DEFAULT;
  return { collapsed: collapsed === 'collapsed', width: clampSidebarWidth(parsed) };
}
