'use client';

import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import type { ChatListItemOut } from '@/shared/api/types';
import { Button, cn, ContextMenu, Menu, MenuItem, MenuSeparator } from '@/shared/ui';
import { useIsAnswering } from '../stream/stream-provider';

const MAX_TITLE = 120;

type Props = {
  chat: ChatListItemOut;
  active: boolean;
  /** The list's one Tab stop (roving focus). */
  tabStop: boolean;
  /** Mail style time on the right ("14:25", "Mo", "19. Sept."). */
  time: string;
  editing: boolean;
  onFocus: () => void;
  onEdit: () => void;
  /** The new title, or null when cancelled. */
  onEditDone: (title: string | null) => void;
  onNavigate: () => void;
  onDelete: () => void;
};

/**
 * One chat row: 32 px, the title truncated, its time on the right. Hover or focus swaps the time
 * for a quiet "..." menu; right click opens the same actions. While the chat answers, a pulsing
 * dot takes the time's place.
 */
export function ChatListItem({ chat, active, tabStop, time, editing, onFocus, onEdit, onEditDone, onNavigate, onDelete }: Props) {
  const t = useTranslations('chat');
  const answering = useIsAnswering(chat.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const title = chat.title ?? t('untitled');

  if (editing) {
    return (
      <li>
        <RenameField initial={chat.title ?? ''} label={t('list.renameLabel')} onDone={onEditDone} />
      </li>
    );
  }

  const items = (
    <>
      <MenuItem onClick={onEdit}>
        <Pencil aria-hidden />
        {t('list.rename')}
        <span className="ml-auto pl-6 text-caption text-ink-muted">F2</span>
      </MenuItem>
      <MenuSeparator />
      <MenuItem danger onClick={onDelete}>
        <Trash2 aria-hidden />
        {t('list.delete')}
      </MenuItem>
    </>
  );

  return (
    <ContextMenu
      onOpenChange={setMenuOpen}
      trigger={
        <li className="group relative">
          <Link
            href={`/chat/${chat.id}`}
            onClick={onNavigate}
            onFocus={onFocus}
            data-chat-row={chat.id}
            tabIndex={tabStop ? 0 : -1}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-8 items-center gap-2 rounded-control pr-2 pl-2 text-body outline-offset-0 pointer-coarse:h-11 pointer-coarse:pr-12',
              'transition-colors duration-150',
              active ? 'bg-fill-strong font-medium text-ink' : 'text-ink/85 hover:bg-fill',
              menuOpen && !active && 'bg-fill',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{title}</span>
            {answering ? (
              <span className="flex size-4 shrink-0 items-center justify-center">
                <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />
                <span className="sr-only">{t('list.answering')}</span>
              </span>
            ) : (
              <span
                aria-hidden
                className={cn(
                  'shrink-0 text-caption font-normal text-ink-muted tabular-nums transition-opacity',
                  'group-hover:opacity-0 group-focus-within:opacity-0 pointer-coarse:hidden',
                  menuOpen && 'opacity-0',
                )}
              >
                {time}
              </span>
            )}
          </Link>
          <div
            className={cn(
              'absolute inset-y-0 right-0.5 flex items-center opacity-0 transition-opacity',
              'group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100',
              menuOpen && 'opacity-100',
            )}
          >
            <Menu
              align="end"
              trigger={
                <Button icon variant="ghost" size="sm" tabIndex={tabStop ? 0 : -1} aria-label={t('list.more', { title })}>
                  <MoreHorizontal />
                </Button>
              }
            >
              {items}
            </Menu>
          </div>
        </li>
      }
    >
      {items}
    </ContextMenu>
  );
}

/** Inline rename: Enter or leaving the field saves, Escape cancels, empty keeps the old title. */
function RenameField({ initial, label, onDone }: { initial: string; label: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const finish = (save: boolean) => {
    const next = value.replace(/\s+/g, ' ').trim();
    onDone(save && next ? next.slice(0, MAX_TITLE) : null);
  };
  return (
    <input
      aria-label={label}
      autoFocus
      value={value}
      maxLength={MAX_TITLE}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      }}
      className="h-8 w-full rounded-control bg-surface px-2 text-body shadow-[inset_0_0_0_1px_var(--c-hairline)] outline-2 outline-accent pointer-coarse:h-11"
    />
  );
}
