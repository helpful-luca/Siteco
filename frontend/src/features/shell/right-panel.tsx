'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useMediaQuery } from '@/shared/lib/use-media-query';
import { Button, cn, SideSheet } from '@/shared/ui';
import { useUI, type PanelContent } from './ui-context';

/** Slot for sources, previews and artifacts: a column on wide windows, a sheet otherwise. */
export function RightPanel() {
  const { panel, closePanel } = useUI();
  const wide = useMediaQuery('(min-width: 1280px)');
  const open = panel !== null;

  // The column is not modal, so Escape is handled here (the sheet below closes itself). Keys that a
  // field, menu or dialog already used (defaultPrevented) or that happen inside one stay theirs.
  useEffect(() => {
    if (!open || !wide) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, wide, closePanel]);

  if (!panel) return null;
  if (wide) {
    return (
      <aside
        data-right-panel
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
        data-right-panel
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
          {panel.subtitle && <div className="truncate text-caption text-ink-muted">{panel.subtitle}</div>}
        </div>
        <Button icon variant="ghost" size="sm" aria-label={t('closePanel')} onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{panel.body}</div>
    </>
  );
}
