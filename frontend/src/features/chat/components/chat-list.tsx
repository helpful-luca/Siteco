'use client';

import { MessagesSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useUI } from '@/features/shell';
import type { ChatListItemOut } from '@/shared/api/types';
import { Button } from '@/shared/ui';
import { groupChats } from '../group-chats';
import { useChats, useDeleteChat, useUpdateChat } from '../queries';
import { isRunning } from '../stream/stream-reducer';
import { useStreamActions } from '../stream/stream-provider';
import { ChatListItem } from './chat-list-item';
import { DeleteChatDialog } from './delete-chat-dialog';

/**
 * The chats in the sidebar, grouped by date like Notes, filtered by the sidebar search. It reads no
 * stream state itself, so streaming answers never re-render the list; each row watches its own chat.
 */
export function ChatList() {
  const t = useTranslations('chat.list');
  const { chatQuery, setSidebarOpen } = useUI();
  const pathname = usePathname();
  const router = useRouter();
  const { data, error, refetch, isFetching } = useChats();
  const { getRun, stop, clear } = useStreamActions();
  const rename = useUpdateChat();
  const remove = useDeleteChat();
  const [deleting, setDeleting] = useState<ChatListItemOut | null>(null);

  const activeId = pathname.startsWith('/chat/') ? pathname.split('/')[2] : null;
  const chats = data?.chats ?? [];
  const groups = groupChats(chats, new Date(), chatQuery);

  const confirmDelete = async (chat: ChatListItemOut) => {
    // A running answer is stopped first (annex 10, E9); the backend would cancel it too.
    if (isRunning(getRun(chat.id))) await stop(chat.id);
    clear(chat.id);
    remove.mutate(chat.id);
    if (chat.id === activeId) router.push('/chat');
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
      <div className="flex gap-2 px-2 text-ink-muted">
        <MessagesSquare aria-hidden className="mt-px size-4 shrink-0 opacity-60" />
        <p className="text-footnote text-ink/80">{chats.length > 0 ? t('noMatch') : t('empty')}</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <section key={group.key} aria-labelledby={`chat-group-${group.key}`}>
            <h2 id={`chat-group-${group.key}`} className="px-2 pb-2 text-caption font-medium text-ink-muted">
              {t(group.key)}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {group.chats.map((chat) => (
                <ChatListItem
                  key={chat.id}
                  chat={chat}
                  active={chat.id === activeId}
                  onNavigate={() => setSidebarOpen(false)}
                  onRename={(title) => rename.mutate({ chatId: chat.id, patch: { title } })}
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
