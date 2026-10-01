'use client';

import { BookOpen, Settings, SquarePen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonStyles, SearchField, Tooltip } from '@/shared/ui';
import { NavItem } from './nav-item';
import { useUI } from './ui-context';

/**
 * Glass sidebar: search, new chat, library, the chats, settings at the bottom.
 * The chat list comes from the chat feature as a slot; it reads the search text from the UI context.
 */
export function Sidebar({ chatList, onNavigate }: { chatList?: ReactNode; onNavigate?: () => void }) {
  const t = useTranslations('shell');
  const { chatQuery, setChatQuery } = useUI();
  return (
    // 12 px from the glass's outer edge (its 1 px border included), so the first row centres on
    // y = 40 like the chat header and the side panel header, and the Mac traffic lights.
    <div className="flex h-full flex-col p-[calc(var(--spacing)*3-1px)]">
      {/*
        In a Mac window the first row belongs to the traffic lights (native, positioned by the
        desktop app on this row's axis) and the new chat button; the search moves to its own row.
      */}
      <div className="drag-region flex flex-wrap items-center gap-1 mac-window:gap-y-2">
        <div aria-hidden className="hidden h-8 flex-1 mac-window:block" />
        <SearchField
          label={t('search')}
          clearLabel={t('clearSearch')}
          value={chatQuery}
          onValueChange={setChatQuery}
          className="flex-1 mac-window:order-last mac-window:basis-full"
        />
        <Tooltip content={t('newChat')}>
          <Link
            href="/chat"
            onClick={onNavigate}
            aria-label={t('newChat')}
            className={buttonStyles({ variant: 'ghost', icon: true })}
          >
            <SquarePen aria-hidden />
          </Link>
        </Tooltip>
      </div>
      <nav aria-label={t('navigation')} className="mt-3 flex flex-col gap-0.5">
        <NavItem href="/library" icon={<BookOpen aria-hidden />} onNavigate={onNavigate}>
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
