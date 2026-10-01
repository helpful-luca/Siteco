'use client';

import { PanelLeft, SquarePen } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { useMediaQuery } from '@/shared/lib/use-media-query';
import { isApplePlatform, isModShortcut } from '@/shared/lib/shortcut';
import { Button, buttonStyles, SideSheet, TooltipProvider } from '@/shared/ui';
import { RightPanel } from './right-panel';
import { Sidebar, SidebarRail } from './sidebar';
import { SIDEBAR_RAIL, type SidebarLayout } from './sidebar-layout';
import { SidebarResizer } from './sidebar-resizer';
import { UIProvider, useUI } from './ui-context';

type Slots = {
  chatList?: ReactNode;
  libraryBadge?: ReactNode;
  /** The command palette (its own feature), mounted inside the UI state. */
  palette?: ReactNode;
};

/** Collapsing and expanding: a spring without overshoot; reduced motion makes it a cut. */
const SPRING = { type: 'spring', duration: 0.42, bounce: 0 } as const;

/**
 * Sidebar | main | right panel. On wide windows the sidebar collapses to an icon rail and can be
 * resized; below 1024 px it becomes a drawer behind a toggle.
 */
export function AppShell({ initialSidebar, children, ...slots }: Slots & { initialSidebar?: SidebarLayout; children: ReactNode }) {
  return (
    <UIProvider initialSidebar={initialSidebar}>
      <TooltipProvider>
        <MotionConfig reducedMotion="user">
          <Frame {...slots}>{children}</Frame>
        </MotionConfig>
      </TooltipProvider>
    </UIProvider>
  );
}

function Frame({ chatList, libraryBadge, palette, children }: Slots & { children: ReactNode }) {
  const t = useTranslations('shell');
  const { sidebarOpen, setSidebarOpen, sidebarCollapsed, setSidebarCollapsed, sidebarWidth, paletteOpen, setPaletteOpen } =
    useUI();
  const wide = useMediaQuery('(min-width: 1024px)');
  const [resizing, setResizing] = useState(false);

  // Command+K opens and closes the palette anywhere; Shift+Command+S (or Command+\) shows and
  // hides the sidebar, like the View menu of Mac apps. Control on Windows and Linux.
  useEffect(() => {
    const apple = isApplePlatform();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isModShortcut(event, 'k', apple)) {
        event.preventDefault();
        setPaletteOpen(!paletteOpen);
      } else if (isModShortcut(event, 's', apple, { shift: true }) || isModShortcut(event, '\\', apple)) {
        event.preventDefault();
        if (wide) setSidebarCollapsed(!sidebarCollapsed);
        else setSidebarOpen(!sidebarOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, setPaletteOpen, wide, sidebarCollapsed, setSidebarCollapsed, sidebarOpen, setSidebarOpen]);

  return (
    // In the frameless desktop window the panels start below the window buttons (--window-top).
    <div className="flex h-dvh gap-3 lg:p-3 lg:pt-[calc(var(--spacing)*3+var(--window-top))]">
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t('skipToContent')}
      </a>
      <motion.aside
        aria-label={t('sidebar')}
        initial={false}
        animate={{ width: sidebarCollapsed ? SIDEBAR_RAIL : sidebarWidth }}
        transition={resizing ? { duration: 0 } : SPRING}
        className="glass specular relative hidden shrink-0 rounded-panel lg:block"
      >
        {/* Clips the content while the width moves; the glass rim stays outside on the aside. */}
        <div className="h-full overflow-hidden rounded-[inherit]">
          <AnimatePresence initial={false} mode="popLayout">
            {sidebarCollapsed ? (
              <motion.div
                key="rail"
                className="h-full"
                style={{ width: SIDEBAR_RAIL }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <SidebarRail />
              </motion.div>
            ) : (
              <motion.div
                key="panel"
                className="h-full"
                style={{ width: sidebarWidth }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <Sidebar chatList={chatList} libraryBadge={libraryBadge} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {!sidebarCollapsed && <SidebarResizer onResizingChange={setResizing} />}
      </motion.aside>
      <SideSheet side="left" label={t('sidebar')} open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <div className="glass-dense specular w-sidebar max-w-[calc(100vw-var(--spacing)*12)] rounded-panel">
          <Sidebar chatList={chatList} libraryBadge={libraryBadge} variant="drawer" onNavigate={() => setSidebarOpen(false)} />
        </div>
      </SideSheet>

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Narrow bar: icon glyphs sit on the page gutter (16 px), buttons are 44 px on touch. In the
          desktop window it centres on the window buttons' axis (y = 20) and keeps its right end free
          for them.
        */}
        <div className="drag-region flex h-12 shrink-0 frameless:h-10 items-center justify-between px-2 pr-[calc(var(--spacing)*2+var(--window-controls))] pointer-coarse:h-14 pointer-coarse:px-0.5 pointer-coarse:pr-[calc(var(--spacing)*0.5+var(--window-controls))] lg:hidden">
          <Button icon variant="ghost" aria-label={t('openSidebar')} onClick={() => setSidebarOpen(true)}>
            <PanelLeft />
          </Button>
          <Link href="/chat" aria-label={t('newChat')} className={buttonStyles({ variant: 'ghost', icon: true })}>
            <SquarePen aria-hidden />
          </Link>
        </div>
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none">
          {children}
        </main>
      </div>

      <RightPanel />
      {palette}
    </div>
  );
}
