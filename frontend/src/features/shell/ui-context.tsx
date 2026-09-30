'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

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
  /** Text of the chat search in the sidebar; the chat list filters by it. */
  chatQuery: string;
  setChatQuery: (query: string) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  panel: PanelContent | null;
  openPanel: (panel: PanelContent) => void;
  closePanel: () => void;
};

const UIContext = createContext<UIState | null>(null);

/** Fleeting UI state: the sidebar drawer on narrow windows and the right panel's content. */
export function UIProvider({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panel, setPanel] = useState<PanelContent | null>(null);
  const [chatQuery, setChatQuery] = useState('');
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
    () => ({ chatQuery, setChatQuery, sidebarOpen, setSidebarOpen, panel, openPanel, closePanel }),
    [chatQuery, sidebarOpen, panel, openPanel, closePanel],
  );
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIState {
  const state = useContext(UIContext);
  if (!state) throw new Error('useUI needs the UIProvider (AppShell)');
  return state;
}
