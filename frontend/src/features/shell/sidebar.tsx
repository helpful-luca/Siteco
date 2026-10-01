'use client';

import { BookOpen, PanelLeft, Search, Settings, SquarePen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useShortcutLabel } from '@/shared/lib/shortcut';
import { Button, buttonStyles, cn, Kbd, Tooltip } from '@/shared/ui';
import { NavItem } from './nav-item';
import { useUI } from './ui-context';

type Props = {
  chatList?: ReactNode;
  /** Quiet count next to "Bibliothek" (the library feature fills it). */
  libraryBadge?: ReactNode;
  /** `panel`: the glass column of wide windows (collapsible); `drawer`: the sheet of narrow ones. */
  variant?: 'panel' | 'drawer';
  onNavigate?: () => void;
};

/**
 * The glass sidebar: collapse, search (opens the command palette), new chat, the library with its
 * count, the chats grouped by date, settings at the bottom.
 */
export function Sidebar({ chatList, libraryBadge, variant = 'panel', onNavigate }: Props) {
  const t = useTranslations('shell');
  const { setPaletteOpen, setSidebarCollapsed, setSidebarOpen } = useUI();
  const searchKey = useShortcutLabel('k');
  const toggleKey = useShortcutLabel('s', { shift: true });

  const openPalette = () => {
    if (variant === 'drawer') setSidebarOpen(false);
    setPaletteOpen(true);
  };

  return (
    // 12 px from the glass's outer edge (its 1 px border included), so the first row shares its
    // axis with the chat header and the side panel header.
    <div className="flex h-full flex-col p-[calc(var(--spacing)*3-1px)]">
      <div className="drag-region flex items-center gap-1">
        {variant === 'panel' && (
          <Tooltip content={<ShortcutHint label={t('collapse')} keys={toggleKey} />}>
            <Button icon variant="ghost" aria-label={t('collapse')} aria-keyshortcuts="Shift+Meta+S Shift+Control+S" onClick={() => setSidebarCollapsed(true)}>
              <PanelLeft />
            </Button>
          </Tooltip>
        )}
        <button
          type="button"
          onClick={openPalette}
          aria-keyshortcuts="Meta+K Control+K"
          aria-haspopup="dialog"
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control bg-fill px-2 text-body text-ink-muted pointer-coarse:h-11',
            'transition-colors hover:bg-fill-strong hover:text-ink',
          )}
        >
          <Search aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{t('search')}</span>
          {searchKey && <Kbd className="bg-transparent pointer-coarse:hidden">{searchKey}</Kbd>}
        </button>
        <Tooltip content={t('newChat')}>
          <Link href="/chat" onClick={onNavigate} aria-label={t('newChat')} className={buttonStyles({ variant: 'ghost', icon: true })}>
            <SquarePen aria-hidden />
          </Link>
        </Tooltip>
      </div>
      <nav aria-label={t('navigation')} className="mt-3 flex flex-col gap-0.5">
        <NavItem href="/library" icon={<BookOpen aria-hidden />} badge={libraryBadge} onNavigate={onNavigate}>
          {t('library')}
        </NavItem>
      </nav>
      <section aria-label={t('chats')} className="-mx-1 mt-6 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1">
        {chatList}
      </section>
      <div className="flex flex-col gap-0.5 pt-3">
        <NavItem href="/settings" icon={<Settings aria-hidden />} onNavigate={onNavigate}>
          {t('settings')}
        </NavItem>
      </div>
    </div>
  );
}

/** The collapsed sidebar: one column of 32 px icon buttons, names in tooltips on the right. */
export function SidebarRail() {
  const t = useTranslations('shell');
  const pathname = usePathname();
  const { setPaletteOpen, setSidebarCollapsed } = useUI();
  const searchKey = useShortcutLabel('k');
  const toggleKey = useShortcutLabel('s', { shift: true });
  const current = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const link = (active: boolean) =>
    cn(buttonStyles({ variant: 'ghost', icon: true }), active && 'bg-fill-strong hover:bg-fill-strong');

  return (
    <div className="flex h-full flex-col items-center gap-1 py-[calc(var(--spacing)*3-1px)]">
      <Tooltip side="right" content={<ShortcutHint label={t('expand')} keys={toggleKey} />}>
        <Button icon variant="ghost" aria-label={t('expand')} aria-expanded={false} onClick={() => setSidebarCollapsed(false)}>
          <PanelLeft />
        </Button>
      </Tooltip>
      <Tooltip side="right" content={<ShortcutHint label={t('search')} keys={searchKey} />}>
        <Button icon variant="ghost" aria-label={t('search')} aria-haspopup="dialog" onClick={() => setPaletteOpen(true)}>
          <Search />
        </Button>
      </Tooltip>
      <Tooltip side="right" content={t('newChat')}>
        <Link href="/chat" aria-label={t('newChat')} className={link(pathname === '/chat')}>
          <SquarePen aria-hidden />
        </Link>
      </Tooltip>
      <Tooltip side="right" content={t('library')}>
        <Link
          href="/library"
          aria-label={t('library')}
          aria-current={current('/library') ? 'page' : undefined}
          className={link(current('/library'))}
        >
          <BookOpen aria-hidden />
        </Link>
      </Tooltip>
      <div className="flex-1" />
      <Tooltip side="right" content={t('settings')}>
        <Link
          href="/settings"
          aria-label={t('settings')}
          aria-current={current('/settings') ? 'page' : undefined}
          className={link(current('/settings'))}
        >
          <Settings aria-hidden />
        </Link>
      </Tooltip>
    </div>
  );
}

function ShortcutHint({ label, keys }: { label: string; keys: string | null }) {
  return (
    <span className="flex items-center gap-2">
      {label}
      {keys && <span className="text-ink-muted">{keys}</span>}
    </span>
  );
}
