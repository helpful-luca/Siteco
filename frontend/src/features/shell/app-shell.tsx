'use client';

import { PanelLeft, SquarePen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button, buttonStyles, SideSheet, TooltipProvider } from '@/shared/ui';
import { GlobalBanner } from './global-banner';
import { RightPanel } from './right-panel';
import { Sidebar } from './sidebar';
import { UIProvider, useUI } from './ui-context';

/** Sidebar | main | right panel. Below 1024 px the sidebar becomes a drawer behind a toggle. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <UIProvider>
      <TooltipProvider>
        <Frame>{children}</Frame>
      </TooltipProvider>
    </UIProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const t = useTranslations('shell');
  const { sidebarOpen, setSidebarOpen } = useUI();
  return (
    <div className="flex h-dvh gap-3 p-2 lg:p-3">
      <a
        href="#main"
        className="sr-only z-50 rounded-control bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t('skipToContent')}
      </a>
      <aside aria-label={t('sidebar')} className="glass hidden w-[264px] shrink-0 rounded-panel lg:block">
        <Sidebar />
      </aside>
      <SideSheet side="left" label={t('sidebar')} open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <div className="glass-dense w-[280px] max-w-[calc(100vw-48px)] rounded-panel">
          <Sidebar onNavigate={() => setSidebarOpen(false)} />
        </div>
      </SideSheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="drag-region flex items-center justify-between px-1 pt-[var(--titlebar-inset)] lg:hidden">
          <Button icon variant="ghost" aria-label={t('openSidebar')} onClick={() => setSidebarOpen(true)}>
            <PanelLeft />
          </Button>
          <Link href="/chat" aria-label={t('newChat')} className={buttonStyles({ variant: 'ghost', icon: true })}>
            <SquarePen aria-hidden />
          </Link>
        </div>
        <GlobalBanner />
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          {children}
        </main>
      </div>

      <RightPanel />
    </div>
  );
}
