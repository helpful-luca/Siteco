'use client';

import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import type { ChatListItemOut } from '@/shared/api/types';
import { Button, cn, Menu, MenuItem, MenuSeparator } from '@/shared/ui';
import { useIsAnswering } from '../stream/stream-provider';

const MAX_TITLE = 120;

type Props = {
  chat: ChatListItemOut;
  active: boolean;
  onNavigate: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
};

/** One chat row: 32 px, the title truncated, a quiet actions button on hover or focus. */
export function ChatListItem({ chat, active, onNavigate, onRename, onDelete }: Props) {
  const t = useTranslations('chat');
  const answering = useIsAnswering(chat.id);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const title = chat.title ?? t('untitled');

  if (editing) {
    return (
      <li>
        <RenameField
          initial={chat.title ?? ''}
          label={t('list.renameLabel')}
          onDone={(next) => {
            setEditing(false);
            if (next !== null && next !== chat.title) onRename(next);
          }}
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <Link
        href={`/chat/${chat.id}`}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-8 items-center gap-2 rounded-control pr-8 pl-2 text-body pointer-coarse:h-11 pointer-coarse:pr-12',
          active ? 'bg-fill-strong font-medium' : 'text-ink/85 hover:bg-fill',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {answering && (
          <span className="flex shrink-0 items-center">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-sodium" />
            <span className="sr-only">{t('list.answering')}</span>
          </span>
        )}
      </Link>
      <div
        className={cn(
          'absolute inset-y-0 right-0.5 flex items-center opacity-0 transition-opacity',
          'group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100',
          menuOpen && 'opacity-100',
        )}
      >
        <Menu
          align="end"
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={
            <Button icon variant="ghost" size="sm" aria-label={t('list.more', { title })}>
              <MoreHorizontal />
            </Button>
          }
        >
          <MenuItem onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            {t('list.rename')}
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger onClick={onDelete}>
            <Trash2 aria-hidden />
            {t('list.delete')}
          </MenuItem>
        </Menu>
      </div>
    </li>
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
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      }}
      className="h-8 w-full rounded-control bg-surface px-2 text-body shadow-[inset_0_0_0_1px_var(--c-hairline)] outline-2 outline-sodium pointer-coarse:h-11"
    />
  );
}
