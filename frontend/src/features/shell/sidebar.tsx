'use client';

import { BookOpen, Gauge, Settings, SquarePen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { buttonStyles, SearchField, Tooltip } from '@/shared/ui';
import { ChatList } from './chat-list';
import { NavItem } from './nav-item';

/** Glass sidebar: search, new chat, library and quality, the chats, settings at the bottom. */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('shell');
  const [query, setQuery] = useState('');
  return (
    <div className="flex h-full flex-col p-3 pt-[calc(12px+var(--titlebar-inset))]">
      <div className="drag-region flex items-center gap-1.5">
        <SearchField
          label={t('search')}
          clearLabel={t('clearSearch')}
          value={query}
          onValueChange={setQuery}
          className="flex-1"
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
        <NavItem href="/quality" icon={<Gauge aria-hidden />} onNavigate={onNavigate}>
          {t('quality')}
        </NavItem>
      </nav>
      <section aria-label={t('chats')} className="mt-6 min-h-0 flex-1 overflow-y-auto">
        <ChatList query={query} />
      </section>
      <div className="flex flex-col gap-0.5 pt-2">
        <NavItem href="/settings" icon={<Settings aria-hidden />} onNavigate={onNavigate}>
          {t('settings')}
        </NavItem>
      </div>
    </div>
  );
}
