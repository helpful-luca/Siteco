'use client';

import { RotateCw, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { Button, Tooltip } from '@/shared/ui';
import { extensionOf } from '../upload/pre-check';
import type { UploadItem } from '../upload/upload-queue';
import { useFormatSize } from '../use-format-size';
import { FileIcon } from './file-icon';
import { FileName } from './file-name';
import { EmptyValue } from './empty-cell';
import { UploadStatus } from './status-cell';

const KINDS = { '.pdf': 'pdf', '.txt': 'txt', '.md': 'md', '.markdown': 'md' } as const;

type Props = { item: UploadItem; onRetry: (id: string) => void; onDismiss: (id: string) => void };

/** A file on its way to the library, or one that did not make it (with the reason). */
export function UploadRow({ item, onRetry, onDismiss }: Props) {
  const t = useTranslations('library');
  const text = useCodeText();
  const formatSize = useFormatSize();
  const name = item.file.name;
  const kind = KINDS[extensionOf(name) as keyof typeof KINDS] ?? null;
  const failed = item.state === 'failed';
  return (
    <tr className="group align-top">
      <td className="py-2 pr-3 pl-4">
        <div className="flex gap-3">
          <div className="flex h-(--row-line) shrink-0 items-center">
            <FileIcon kind={kind} className={failed ? 'opacity-60' : undefined} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex h-(--row-line) items-center">
              <FileName name={name} />
            </div>
            <p className="text-caption text-ink-muted tabular-nums @3xl:hidden">{formatSize(item.file.size)}</p>
            <div className="mt-0.5 [--row-line:--spacing(7)] @lg:hidden">
              <UploadStatus item={item} />
            </div>
            {failed && item.error && (
              <p role="alert" className="mt-1 text-footnote text-danger">
                {text.error(item.error.code, item.error.params)}
              </p>
            )}
          </div>
        </div>
      </td>
      <td className="hidden px-3 py-2 @lg:table-cell">
        <UploadStatus item={item} />
      </td>
      <td className="hidden px-3 py-2 text-right text-footnote leading-(--row-line) text-ink-muted @3xl:table-cell">
        <EmptyValue label={t('noPages')} />
      </td>
      <td className="hidden px-3 py-2 text-right text-footnote leading-(--row-line) text-ink-muted tabular-nums whitespace-nowrap @3xl:table-cell">
        {formatSize(item.file.size)}
      </td>
      <td className="hidden px-3 py-2 @4xl:table-cell">
        <EmptyValue label={t('notAddedYet')} />
      </td>
      <td className="py-2 pr-2 pl-0">
        <div className="flex h-(--row-line) items-center justify-end gap-1">
          {failed && item.error?.retryable && (
            <Tooltip content={t('actions.retry')}>
              <Button icon size="sm" variant="ghost" aria-label={t('actions.retryOf', { name })} onClick={() => onRetry(item.id)}>
                <RotateCw />
              </Button>
            </Tooltip>
          )}
          <Tooltip content={failed ? t('actions.dismiss') : t('actions.cancel')}>
            <Button
              icon
              size="sm"
              variant="ghost"
              aria-label={failed ? t('actions.dismissOf', { name }) : t('actions.cancelOf', { name })}
              onClick={() => onDismiss(item.id)}
            >
              <X />
            </Button>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}
