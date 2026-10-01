'use client';

import { X } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useRef } from 'react';
import { useMediaQuery } from '@/shared/lib/use-media-query';
import { Button, cn, SideSheet } from '@/shared/ui';
import { useUI, type PanelContent } from './ui-context';

/** Opening and closing the column: a spring without overshoot; reduced motion makes it a cut. */
const SLIDE = { type: 'spring', duration: 0.4, bounce: 0 } as const;

/**
 * Slot for sources, previews and artifacts: a column on wide windows that slides in from the
 * right (the chat makes room as it comes), a sheet otherwise.
 */
export function RightPanel() {
  const { panel, closePanel } = useUI();
  const wide = useMediaQuery('(min-width: 1280px)');
  const open = panel !== null;
  const column = useRef<HTMLElement>(null);
  const panelId = panel?.id ?? null;

  // Focus moves into the column when it opens or shows something new (the sheet does this
  // itself); closing gives it back to the opener (ui-context).
  useEffect(() => {
    if (panelId && wide) column.current?.focus({ preventScroll: true });
  }, [panelId, wide]);

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

  if (wide) {
    return (
      <MotionConfig reducedMotion="user">
        <AnimatePresence initial={false}>
          {panel && (
            // The wrapper carries the 12 px gap, so the chat column widens and narrows smoothly; the clip
            // margin keeps the panel shadow visible.
            <motion.div
              key="right-panel"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={SLIDE}
              className="-ml-3 flex shrink-0 justify-end overflow-clip [overflow-clip-margin:calc(var(--spacing)*6)]"
            >
              <motion.aside
                ref={column}
                tabIndex={-1}
                data-right-panel
                aria-label={panel.title}
                initial={{ x: 48 }}
                animate={{ x: 0 }}
                exit={{ x: 48 }}
                transition={SLIDE}
                className={cn(
                  'ml-3 flex shrink-0 flex-col overflow-hidden rounded-panel bg-surface shadow-float ring-1 ring-hairline outline-none',
                  panel.size === 'wide' ? 'w-panel-wide' : 'w-panel',
                )}
              >
                <PanelBody panel={panel} onClose={closePanel} />
              </motion.aside>
            </motion.div>
          )}
        </AnimatePresence>
      </MotionConfig>
    );
  }
  if (!panel) return null;
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
      <header className="glass drag-region flex h-14 shrink-0 items-center justify-between gap-3 rounded-none border-0 border-b border-hairline pr-4 pl-6 shadow-none pointer-coarse:pr-2">
        <div className="min-w-0">
          <h2 className="truncate text-body font-medium">{panel.title}</h2>
          {panel.subtitle && <div className="truncate text-caption text-ink-muted">{panel.subtitle}</div>}
        </div>
        <Button icon variant="ghost" size="sm" aria-label={t('closePanel')} onClick={onClose}>
          <X />
        </Button>
      </header>
      {/* Keyed by the panel: another source or document starts with fresh viewer state. */}
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <Fragment key={panel.id}>{panel.body}</Fragment>
      </div>
    </>
  );
}
