'use client';

import { PanelLeft, SquarePen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button, buttonStyles, SideSheet, TooltipProvider } from '@/shared/ui';
import { RightPanel } from './right-panel';
import { Sidebar } from './sidebar';
import { UIProvider, useUI } from './ui-context';

/** Sidebar | main | right panel. Below 1024 px the sidebar becomes a drawer behind a toggle. */
export function AppShell({ chatList, children }: { chatList?: ReactNode; children: ReactNode }) {
  return (
    <UIProvider>
      <TooltipProvider>
        <Frame chatList={chatList}>{children}</Frame>
      </TooltipProvider>
    </UIProvider>
  );
}

function Frame({ chatList, children }: { chatList?: ReactNode; children: ReactNode }) {
  const t = useTranslations('shell');
  const { sidebarOpen, setSidebarOpen } = useUI();
  return (
    // On Windows the title band with the native caption buttons sits above (--window-bar).
    <div className="flex h-dvh gap-3 pt-(--window-bar) lg:p-3 lg:pt-[calc(var(--spacing)*3+var(--window-bar))]">
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t('skipToContent')}
      </a>
      <aside aria-label={t('sidebar')} className="glass hidden w-sidebar shrink-0 rounded-panel lg:block">
        <Sidebar chatList={chatList} />
      </aside>
      <SideSheet side="left" label={t('sidebar')} open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <div className="glass-dense w-sidebar max-w-[calc(100vw-var(--spacing)*12)] rounded-panel">
          <Sidebar chatList={chatList} onNavigate={() => setSidebarOpen(false)} />
        </div>
      </SideSheet>

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Narrow bar: icon glyphs sit on the page gutter (16 px), buttons are 44 px on touch. In a
          Mac window it starts right of the traffic lights and centres on their axis.
        */}
        <div className="drag-region flex h-[calc(var(--spacing)*12+var(--titlebar-inset))] shrink-0 items-center justify-between px-2 pt-(--titlebar-inset) pl-[calc(var(--spacing)*2+var(--traffic-lights))] pointer-coarse:h-[calc(var(--spacing)*14+var(--titlebar-inset))] pointer-coarse:px-0.5 lg:hidden">
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
    </div>
  );
}
