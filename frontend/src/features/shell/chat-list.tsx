'use client';

import { MessagesSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * Chats of this workspace, grouped by date. Chats arrive with the chat backend (phase 4);
 * until then this is the calm empty state.
 */
export function ChatList({ query }: { query: string }) {
  const t = useTranslations('shell');
  return (
    <div className="px-2">
      <h2 className="pb-2 text-caption font-medium text-ink-muted">{t('chats')}</h2>
      <div className="flex gap-2.5 text-ink-muted">
        <MessagesSquare aria-hidden className="mt-0.5 size-4 shrink-0 opacity-60" />
        <div>
          <p className="text-footnote text-ink/80">{query ? t('noChatsFound') : t('noChats')}</p>
          <p className="mt-0.5 text-caption">{t('noChatsHint')}</p>
        </div>
      </div>
    </div>
  );
}
