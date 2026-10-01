'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { writeCookie } from '@/shared/preferences/write-cookie';
import { clampSidebarWidth, SIDEBAR_COOKIE, SIDEBAR_DEFAULT, SIDEBAR_WIDTH_COOKIE, type SidebarLayout } from './sidebar-layout';

export type PanelContent = {
  id: string;
  title: string;
  /** A string, or a live node such as the viewer's "Seite 4 von 12". */
  subtitle?: ReactNode;
  /** `wide` for reading views such as artifacts (640 px instead of 440 px). */
  size?: 'default' | 'wide';
  body: ReactNode;
};

type UIState = {
  /** The command palette (Cmd+K). */
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** Wide windows: the sidebar is collapsed to its icon rail. Remembered in a cookie. */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** Wide windows: the sidebar's width while expanded; `commit` remembers it (end of a drag). */
  sidebarWidth: number;
  setSidebarWidth: (width: number, commit?: boolean) => void;
  /** Narrow windows: the sidebar drawer. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  panel: PanelContent | null;
  openPanel: (panel: PanelContent) => void;
  closePanel: () => void;
};

const UIContext = createContext<UIState | null>(null);

/**
 * Window UI state: the palette, the sidebar (rail or expanded, its width, the drawer on narrow
 * windows) and the right panel's content.
 */
export function UIProvider({
  initialSidebar = { collapsed: false, width: SIDEBAR_DEFAULT },
  children,
}: {
  initialSidebar?: SidebarLayout;
  children: ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarCollapsed, setCollapsed] = useState(initialSidebar.collapsed);
  const [sidebarWidth, setWidth] = useState(initialSidebar.width);
  const [panel, setPanel] = useState<PanelContent | null>(null);
  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setCollapsed(collapsed);
    writeCookie(SIDEBAR_COOKIE, collapsed ? 'collapsed' : 'open');
  }, []);
  const setSidebarWidth = useCallback((width: number, commit = false) => {
    const next = clampSidebarWidth(width);
    setWidth(next);
    if (commit) writeCookie(SIDEBAR_WIDTH_COOKIE, String(next));
  }, []);
  // The control that opened the panel (a chip, a preview button) gets focus back on close.
  const opener = useRef<HTMLElement | null>(null);
  const openPanel = useCallback((next: PanelContent) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !active.closest('[data-right-panel]')) {
      opener.current = active;
    }
    setPanel(next);
  }, []);
  const closePanel = useCallback(() => {
    setPanel(null);
    const target = opener.current;
    opener.current = null;
    if (target?.isConnected) requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }, []);

  // The drawer only exists on narrow windows; widening the window closes it.
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)');
    const close = () => wide.matches && setSidebarOpen(false);
    wide.addEventListener('change', close);
    return () => wide.removeEventListener('change', close);
  }, []);

  const value = useMemo(
    () => ({
      paletteOpen,
      setPaletteOpen,
      sidebarCollapsed,
      setSidebarCollapsed,
      sidebarWidth,
      setSidebarWidth,
      sidebarOpen,
      setSidebarOpen,
      panel,
      openPanel,
      closePanel,
    }),
    [paletteOpen, sidebarCollapsed, setSidebarCollapsed, sidebarWidth, setSidebarWidth, sidebarOpen, panel, openPanel, closePanel],
  );
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIState {
  const state = useContext(UIContext);
  if (!state) throw new Error('useUI needs the UIProvider (AppShell)');
  return state;
}
