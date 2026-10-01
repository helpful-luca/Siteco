'use client';

import { Paperclip, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DocumentOut } from '@/shared/api/types';
import { Button, Popover, Tooltip, ToolbarButton } from '@/shared/ui';
import { useAddToLibrary, useAttachments, useRemoveAttachment } from '../queries';
import { statusView } from '../status';
import { FileIcon } from './file-icon';

/**
 * The chat's attachments behind a toolbar button: each with where it lives (this chat only, or
 * the library), the action to move it into the library, and removing it from the chat.
 * Hidden while the chat has none.
 */
export function AttachmentsButton({ chatId }: { chatId: string }) {
  const t = useTranslations('library.attachments');
  const { data } = useAttachments(chatId);
  const documents = (data?.documents ?? []).filter((d) => d.status !== 'deleting');
  if (documents.length === 0) return null;
  return (
    <Popover
      title={t('title')}
      trigger={
        <ToolbarButton aria-label={t('button', { count: documents.length })}>
          <Paperclip aria-hidden />
          <span className="tabular-nums">{documents.length}</span>
        </ToolbarButton>
      }
    >
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5">
        {documents.map((document) => (
          <AttachmentRow key={document.id} chatId={chatId} document={document} />
        ))}
      </ul>
      <p className="px-3 pt-1 pb-3 text-caption text-ink-muted">{t('footer')}</p>
    </Popover>
  );
}

function AttachmentRow({ chatId, document }: { chatId: string; document: DocumentOut }) {
  const t = useTranslations('library.attachments');
  const status = useTranslations('library.status');
  const addToLibrary = useAddToLibrary();
  const remove = useRemoveAttachment();
  const view = statusView(document);
  const name = document.filename;
  const where = document.in_library ? t('inLibrary') : t('chatOnly');
  return (
    <li className="flex items-start gap-2.5 rounded-inner px-1.5 py-2">
      <FileIcon kind={document.kind} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body" title={name}>
          {name}
        </p>
        <p className="text-caption text-ink-muted">
          {view.tone === 'ready' ? where : `${status(view.key, view.values)} · ${where}`}
        </p>
        {!document.in_library && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('addToLibraryOf', { name })}
            disabled={addToLibrary.isPending}
            onClick={() => addToLibrary.mutate(document.id)}
            className="-ml-3 text-accent-ink"
          >
            {t('addToLibrary')}
          </Button>
        )}
      </div>
      <Tooltip content={t('remove')}>
        <Button
          icon
          size="sm"
          variant="ghost"
          aria-label={t('removeOf', { name })}
          onClick={() => remove.mutate({ chatId, documentId: document.id })}
        >
          <X />
        </Button>
      </Tooltip>
    </li>
  );
}
