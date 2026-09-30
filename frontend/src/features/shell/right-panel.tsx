'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMediaQuery } from '@/shared/lib/use-media-query';
import { Button, cn, SideSheet } from '@/shared/ui';
import { useUI, type PanelContent } from './ui-context';

/** Slot for sources, previews and artifacts: a column on wide windows, a sheet otherwise. */
export function RightPanel() {
  const { panel, closePanel } = useUI();
  const wide = useMediaQuery('(min-width: 1280px)');
  if (!panel) return null;
  if (wide) {
    return (
      <aside
        aria-label={panel.title}
        className={cn(
          'flex shrink-0 flex-col overflow-hidden rounded-panel bg-surface shadow-float ring-1 ring-hairline',
          panel.size === 'wide' ? 'w-panel-wide' : 'w-panel',
        )}
      >
        <PanelBody panel={panel} onClose={closePanel} />
      </aside>
    );
  }
  return (
    <SideSheet side="right" label={panel.title} open onOpenChange={(open) => !open && closePanel()}>
      <div
        className={cn(
          'flex flex-col overflow-hidden rounded-panel bg-surface shadow-float ring-1 ring-hairline',
          panel.size === 'wide'
            ? 'w-[min(var(--spacing-panel-wide),calc(100vw-var(--spacing)*4))]'
            : 'w-[min(var(--spacing-panel),calc(100vw-var(--spacing)*4))]',
        )}
      >
        <PanelBody panel={panel} onClose={closePanel} />
      </div>
    </SideSheet>
  );
}

function PanelBody({ panel, onClose }: { panel: PanelContent; onClose: () => void }) {
  const t = useTranslations('shell');
  return (
    <>
      {/* 56 px bar: centered on the sidebar's first row; text on the body's 24 px inset. */}
      <header className="glass drag-region flex h-[calc(var(--spacing)*14+var(--titlebar-inset))] shrink-0 items-center justify-between gap-3 rounded-none border-0 border-b border-hairline pt-(--titlebar-inset) pr-4 pl-6 shadow-none pointer-coarse:pr-2">
        <div className="min-w-0">
          <h2 className="truncate text-body font-medium">{panel.title}</h2>
          {panel.subtitle && <p className="truncate text-caption text-ink-muted">{panel.subtitle}</p>}
        </div>
        <Button icon variant="ghost" size="sm" aria-label={t('closePanel')} onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{panel.body}</div>
    </>
  );
}
