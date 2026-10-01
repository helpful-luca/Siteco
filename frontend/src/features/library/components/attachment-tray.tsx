'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import type { DocumentOut } from '@/shared/api/types';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { Button, Tooltip } from '@/shared/ui';
import { useAttachments, useRemoveAttachment } from '../queries';
import { isInProgress } from '../status';
import { kindOfFileName } from '../upload/pre-check';
import type { UploadItem } from '../upload/upload-queue';
import { useUploads } from '../upload/upload-provider';
import { FileIcon } from './file-icon';
import { DocumentStatus, UploadStatus } from './status-cell';

/**
 * Files on their way into this chat, above the composer: upload progress, then processing, and
 * the calm question whether a file should also go into the library (default: only this chat).
 * A file leaves the tray once it is ready and the question is answered; failures stay with
 * their reason until removed. The full list lives behind the attachments button.
 */
export function AttachmentTray({ chatId }: { chatId: string }) {
  const t = useTranslations('library.attachments');
  const uploads = useUploads();
  const { data } = useAttachments(chatId);
  const remove = useRemoveAttachment();
  const items = uploads.items.filter((i) => i.chatId === chatId);
  const asking = new Set(uploads.asking);
  const documents = (data?.documents ?? []).filter(
    (d) => d.status !== 'deleting' && (isInProgress(d.status) || d.status === 'failed' || asking.has(d.id)),
  );
  if (items.length === 0 && documents.length === 0) return null;
  return (
    <ul aria-label={t('title')} className="pointer-events-auto flex flex-col gap-1.5">
      {items.map((item) => (
        <UploadChip
          key={item.id}
          item={item}
          onChoose={(toLibrary) => uploads.choose(item.id, toLibrary)}
          onDismiss={() => uploads.dismiss(item.id)}
        />
      ))}
      {documents.map((document) => (
        <DocumentChip
          key={document.id}
          document={document}
          asking={asking.has(document.id)}
          onAnswer={(toLibrary) => uploads.answer(document.id, toLibrary)}
          onRemove={() => {
            uploads.answer(document.id, false);
            remove.mutate({ chatId, documentId: document.id });
          }}
        />
      ))}
    </ul>
  );
}

function Chip({
  name,
  icon,
  status,
  detail,
  action,
}: {
  name: string;
  icon: ReactNode;
  status: ReactNode;
  detail?: ReactNode;
  action: ReactNode;
}) {
  return (
    <li className="@container glass-dense rounded-card px-3 py-2 [--row-line:--spacing(7)]">
      <div className="flex items-start gap-2.5">
        <div className="flex h-7 shrink-0 items-center">{icon}</div>
        {/* Narrow (phones): the status goes under the name, so the name keeps its room. */}
        <div className="min-w-0 flex-1">
          <div className="@md:flex @md:items-start @md:gap-3">
            <p className="min-w-0 truncate text-body leading-7 @md:flex-1" title={name}>
              {name}
            </p>
            <div className="shrink-0">{status}</div>
          </div>
          {detail}
        </div>
        {action}
      </div>
    </li>
  );
}

/** "Also into the library?" with the two answers; the first is what happens without one. */
function LibraryQuestion({ onAnswer }: { onAnswer: (toLibrary: boolean) => void }) {
  const t = useTranslations('library.attachments');
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      <p className="text-footnote text-ink-muted">{t('ask')}</p>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="secondary" onClick={() => onAnswer(false)}>
          {t('chatOnly')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onAnswer(true)}>
          {t('toLibrary')}
        </Button>
      </div>
    </div>
  );
}

function UploadChip({
  item,
  onChoose,
  onDismiss,
}: {
  item: UploadItem;
  onChoose: (toLibrary: boolean) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations('library');
  const text = useCodeText();
  const name = item.name;
  const kind = kindOfFileName(name);
  const failed = item.state === 'failed';
  let detail: ReactNode = null;
  if (failed && item.error) {
    detail = (
      <p role="alert" className="mt-1 text-footnote text-danger">
        {text.error(item.error.code, item.error.params)}
      </p>
    );
  } else if (item.toLibrary === null) {
    detail = <LibraryQuestion onAnswer={onChoose} />;
  } else if (item.toLibrary) {
    detail = <p className="mt-1 text-footnote text-ink-muted">{t('attachments.willAdd')}</p>;
  }
  return (
    <Chip
      name={name}
      icon={<FileIcon kind={kind} className={failed ? 'opacity-60' : undefined} />}
      status={<UploadStatus item={item} />}
      detail={detail}
      action={
        <Tooltip content={failed ? t('actions.dismiss') : t('actions.cancel')}>
          <Button
            icon
            size="sm"
            variant="ghost"
            aria-label={failed ? t('actions.dismissOf', { name }) : t('actions.cancelOf', { name })}
            onClick={onDismiss}
          >
            <X />
          </Button>
        </Tooltip>
      }
    />
  );
}

function DocumentChip({
  document,
  asking,
  onAnswer,
  onRemove,
}: {
  document: DocumentOut;
  asking: boolean;
  onAnswer: (toLibrary: boolean) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('library.attachments');
  const text = useCodeText();
  const name = document.filename;
  let detail: ReactNode = null;
  if (document.status === 'failed' && document.error_code) {
    detail = (
      <p role="alert" className="mt-1 text-footnote text-danger">
        {text.error(document.error_code, document.error_params)}
      </p>
    );
  } else if (asking && !document.in_library) {
    detail = <LibraryQuestion onAnswer={onAnswer} />;
  }
  return (
    <Chip
      name={name}
      icon={<FileIcon kind={document.kind} />}
      status={<DocumentStatus document={document} />}
      detail={detail}
      action={
        <Tooltip content={t('remove')}>
          <Button icon size="sm" variant="ghost" aria-label={t('removeOf', { name })} onClick={onRemove}>
            <X />
          </Button>
        </Tooltip>
      }
    />
  );
}
