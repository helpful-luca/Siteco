'use client';

import { MessagesSquare } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { type KeyboardEvent, useRef, useState } from 'react';
import { useUI } from '@/features/shell';
import type { ChatListItemOut } from '@/shared/api/types';
import { isApplePlatform } from '@/shared/lib/shortcut';
import { Button } from '@/shared/ui';
import { formatListTime } from '../format';
import { groupChats } from '../group-chats';
import { useChats, useDeleteChat, useUpdateChat } from '../queries';
import { isRunning } from '../stream/stream-reducer';
import { useStreamActions } from '../stream/stream-provider';
import { ChatListItem } from './chat-list-item';
import { DeleteChatDialog } from './delete-chat-dialog';

/**
 * The chats in the sidebar, grouped by date like Notes. A list you can drive by keyboard like
 * Finder: one Tab stop, arrow keys, Home and End move between rows, Enter opens, F2 renames,
 * Delete (or Command+Backspace) asks to delete. Right click opens the same actions as the "..."
 * button. It reads no stream state itself, so streaming answers never re-render the list; each
 * row watches its own chat.
 */
export function ChatList() {
  const t = useTranslations('chat.list');
  const locale = useLocale();
  const { setSidebarOpen } = useUI();
  const pathname = usePathname();
  const router = useRouter();
  const { data, error, refetch, isFetching } = useChats();
  const { getRun, stop, clear } = useStreamActions();
  const rename = useUpdateChat();
  const remove = useDeleteChat();
  const [deleting, setDeleting] = useState<ChatListItemOut | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [roving, setRoving] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  const activeId = pathname.startsWith('/chat/') ? pathname.split('/')[2] : null;
  const chats = data?.chats ?? [];
  const now = new Date();
  const groups = groupChats(chats, now);
  const ordered = groups.flatMap((group) => group.chats);
  // One Tab stop for the whole list: the row last focused, else the open chat, else the first.
  const tabStop = [roving, activeId].find((id) => id && ordered.some((c) => c.id === id)) ?? ordered[0]?.id;

  const focusRow = (id: string) =>
    requestAnimationFrame(() => container.current?.querySelector<HTMLElement>(`[data-chat-row="${id}"]`)?.focus());

  const confirmDelete = async (chat: ChatListItemOut) => {
    // A running answer is stopped first (annex 10, E9); the backend would cancel it too.
    if (isRunning(getRun(chat.id))) await stop(chat.id);
    const index = ordered.findIndex((c) => c.id === chat.id);
    const neighbour = ordered[index + 1] ?? ordered[index - 1];
    clear(chat.id);
    remove.mutate(chat.id);
    if (neighbour) {
      setRoving(neighbour.id);
      focusRow(neighbour.id);
    }
    if (chat.id === activeId) router.push('/chat');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-chat-row]');
    if (!row || event.nativeEvent.isComposing) return;
    const id = row.dataset.chatRow!;
    const index = ordered.findIndex((c) => c.id === id);
    const target =
      event.key === 'ArrowDown'
        ? ordered[index + 1]
        : event.key === 'ArrowUp'
          ? ordered[index - 1]
          : event.key === 'Home'
            ? ordered[0]
            : event.key === 'End'
              ? ordered.at(-1)
              : undefined;
    if (target) {
      event.preventDefault();
      setRoving(target.id);
      focusRow(target.id);
      return;
    }
    const mod = isApplePlatform() ? event.metaKey : event.ctrlKey;
    if (event.key === 'F2') {
      event.preventDefault();
      setEditing(id);
    } else if (event.key === 'Delete' || (event.key === 'Backspace' && mod)) {
      event.preventDefault();
      setDeleting(ordered[index] ?? null);
    }
  };

  if (!data) {
    if (!error) return null;
    return (
      <div className="px-2">
        <p className="text-footnote text-ink-muted">{t('loadError')}</p>
        <Button size="sm" className="mt-2" disabled={isFetching} onClick={() => refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 px-2 pt-1">
        <MessagesSquare aria-hidden className="size-5 text-ink-muted/70" />
        <p className="text-footnote text-ink-muted">{t('empty')}</p>
      </div>
    );
  }

  return (
    <>
      <div ref={container} className="flex flex-col gap-4" onKeyDown={onKeyDown}>
        {groups.map((group) => (
          <section key={group.key} aria-labelledby={`chat-group-${group.key}`}>
            <h2 id={`chat-group-${group.key}`} className="px-2 pb-2 text-caption font-semibold text-ink-muted">
              {t(group.key)}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {group.chats.map((chat) => (
                <ChatListItem
                  key={chat.id}
                  chat={chat}
                  active={chat.id === activeId}
                  tabStop={chat.id === tabStop}
                  time={formatListTime(chat.updated_at, now, locale)}
                  editing={editing === chat.id}
                  onFocus={() => setRoving(chat.id)}
                  onEdit={() => setEditing(chat.id)}
                  onEditDone={(title) => {
                    setEditing(null);
                    if (title !== null && title !== chat.title) rename.mutate({ chatId: chat.id, patch: { title } });
                    focusRow(chat.id);
                  }}
                  onNavigate={() => setSidebarOpen(false)}
                  onDelete={() => setDeleting(chat)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <DeleteChatDialog
        chat={deleting}
        running={deleting ? isRunning(getRun(deleting.id)) : false}
        onConfirm={(chat) => void confirmDelete(chat)}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
