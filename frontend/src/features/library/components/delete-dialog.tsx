'use client';

import { useTranslations } from 'next-intl';
import type { DocumentOut } from '@/shared/api/types';
import { Button, Dialog, DialogClose } from '@/shared/ui';

type Props = {
  document: DocumentOut | null;
  onConfirm: (document: DocumentOut) => void;
  onClose: () => void;
};

/** Deleting is final (files, search data, row). Cancel comes first and gets the focus. */
export function DeleteDialog({ document, onConfirm, onClose }: Props) {
  const t = useTranslations('library.delete');
  return (
    <Dialog
      open={document !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('title')}
      description={document ? t('text', { name: document.filename }) : undefined}
      className="w-[min(var(--spacing-panel),calc(100vw-var(--spacing)*8))]"
    >
      <div className="flex justify-end gap-2">
        <DialogClose render={<Button>{t('cancel')}</Button>} />
        <Button
          variant="danger"
          onClick={() => {
            if (document) onConfirm(document);
            onClose();
          }}
        >
          {t('confirm')}
        </Button>
      </div>
    </Dialog>
  );
}
