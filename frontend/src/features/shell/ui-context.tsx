'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type PanelContent = { id: string; title: string; subtitle?: string; body: ReactNode };

type UIState = {
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
  const closePanel = useCallback(() => setPanel(null), []);

  // The drawer only exists on narrow windows; widening the window closes it.
  useEffect(() => {
    const wide = window.matchMedia('(min-width: 1024px)');
    const close = () => wide.matches && setSidebarOpen(false);
    wide.addEventListener('change', close);
    return () => wide.removeEventListener('change', close);
  }, []);

  const value = useMemo(
    () => ({ sidebarOpen, setSidebarOpen, panel, openPanel: setPanel, closePanel }),
    [sidebarOpen, panel, closePanel],
  );
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIState {
  const state = useContext(UIContext);
  if (!state) throw new Error('useUI needs the UIProvider (AppShell)');
  return state;
}
