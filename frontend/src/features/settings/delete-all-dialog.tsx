'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, Dialog, DialogClose, Switch } from '@/shared/ui';

type Props = {
  open: boolean;
  counts: { documents: number; chats: number } | null;
  busy: boolean;
  onConfirm: (resetPreferences: boolean) => void;
  onClose: () => void;
};

/**
 * The strongest confirmation in the app: it names what disappears, says it is final, and Cancel
 * comes first and holds the focus. Resetting the settings is a separate choice.
 */
export function DeleteAllDialog({ open, counts, busy, onConfirm, onClose }: Props) {
  const t = useTranslations('settings.deleteDialog');
  const [reset, setReset] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && !busy && onClose()}
      title={t('title')}
      description={t('text', { documents: counts?.documents ?? 0, chats: counts?.chats ?? 0 })}
      className="w-[min(var(--spacing-panel),calc(100vw-var(--spacing)*8))]"
    >
      <div className="flex flex-col gap-6">
        <div>
          <Switch label={t('reset')} checked={reset} onCheckedChange={setReset} disabled={busy} />
          <p className="mt-1 pl-15 text-footnote text-ink-muted">{t('resetHint')}</p>
        </div>
        <div className="flex justify-end gap-2">
          <DialogClose render={<Button autoFocus disabled={busy}>{t('cancel')}</Button>} />
          <Button variant="danger" disabled={busy} onClick={() => onConfirm(reset)}>
            {t('confirm')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
