'use client';

import { useTranslations } from 'next-intl';
import type { ChatListItemOut } from '@/shared/api/types';
import { Button, Dialog, DialogClose } from '@/shared/ui';

type Props = {
  chat: ChatListItemOut | null;
  running: boolean;
  onConfirm: (chat: ChatListItemOut) => void;
  onClose: () => void;
};

/** Deleting a chat is final. Cancel comes first and gets the focus. */
export function DeleteChatDialog({ chat, running, onConfirm, onClose }: Props) {
  const t = useTranslations('chat');
  const title = chat?.title ?? t('untitled');
  return (
    <Dialog
      open={chat !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('delete.title')}
      description={chat ? `${t('delete.text', { title })}${running ? ` ${t('delete.running')}` : ''}` : undefined}
      className="w-[min(var(--spacing-panel),calc(100vw-var(--spacing)*8))]"
    >
      <div className="flex justify-end gap-2">
        <DialogClose render={<Button>{t('delete.cancel')}</Button>} />
        <Button
          variant="danger"
          onClick={() => {
            if (chat) onConfirm(chat);
            onClose();
          }}
        >
          {t('delete.confirm')}
        </Button>
      </div>
    </Dialog>
  );
}
