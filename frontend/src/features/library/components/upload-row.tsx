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
      <td className="py-2.5 pr-3 pl-3 @lg:pl-4">
        <div className="flex gap-3">
          <FileIcon kind={kind} className={failed ? 'opacity-60' : undefined} />
          <div className="min-w-0 flex-1 pt-[3px]">
            <FileName name={name} />
            <p className="text-caption text-ink-muted @2xl:hidden">{formatSize(item.file.size)}</p>
            <div className="mt-1.5 @lg:hidden">
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
      <td className="hidden py-3 pr-3 @lg:table-cell">
        <UploadStatus item={item} />
      </td>
      <td className="hidden py-3 pr-4 text-right text-footnote text-ink-muted @2xl:table-cell">
        <span aria-label={t('noPages')}>--</span>
      </td>
      <td className="hidden py-3 pr-4 text-right text-footnote text-ink-muted tabular-nums whitespace-nowrap @2xl:table-cell">
        {formatSize(item.file.size)}
      </td>
      <td className="hidden py-3 pr-3 @4xl:table-cell" />
      <td className="py-2 pr-2 @lg:pr-3">
        <div className="flex justify-end gap-0.5">
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
