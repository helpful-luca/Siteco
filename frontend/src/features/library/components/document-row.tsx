'use client';

import { Eye, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { DocumentOut } from '@/shared/api/types';
import { Button, FileLabel, Tooltip } from '@/shared/ui';
import { useFormatSize } from '../use-format-size';
import { FileIcon } from './file-icon';
import { RowDetails, RowNotices } from './row-details';
import { EmptyValue } from './empty-cell';
import { DocumentStatus } from './status-cell';

type Props = {
  document: DocumentOut;
  onPreview: (document: DocumentOut) => void;
  onDelete: (document: DocumentOut) => void;
};

export function DocumentRow({ document, onPreview, onDelete }: Props) {
  const t = useTranslations('library');
  const format = useFormatter();
  const formatSize = useFormatSize();
  const size = formatSize(document.size_bytes);
  const added = format.dateTime(new Date(document.created_at), { dateStyle: 'medium', timeStyle: 'short' });
  const pages = document.page_count === null ? null : format.number(document.page_count);
  return (
    <tr className="group align-top">
      <td className="py-2 pr-3 pl-4">
        <div className="flex gap-3">
          <div className="flex h-(--row-line) shrink-0 items-center">
            <FileIcon kind={document.kind} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex h-(--row-line) items-center gap-1">
              <FileLabel className="text-body font-medium" name={document.filename} />
              <RowNotices document={document} />
            </div>
            <p className="text-caption text-ink-muted tabular-nums @3xl:hidden">
              {pages === null ? size : t('meta', { pages: document.page_count ?? 0, size })}
            </p>
            <div className="mt-0.5 [--row-line:--spacing(7)] @lg:hidden">
              <DocumentStatus document={document} />
            </div>
            <RowDetails document={document} />
          </div>
        </div>
      </td>
      <td className="hidden px-3 py-2 @lg:table-cell">
        <DocumentStatus document={document} />
      </td>
      <td className="hidden px-3 py-2 text-right text-footnote leading-(--row-line) text-ink-muted tabular-nums @3xl:table-cell">
        {pages ?? <EmptyValue label={t('noPages')} />}
      </td>
      <td className="hidden px-3 py-2 text-right text-footnote leading-(--row-line) text-ink-muted tabular-nums whitespace-nowrap @3xl:table-cell">
        {size}
      </td>
      <td className="hidden truncate px-3 py-2 text-footnote leading-(--row-line) text-ink-muted tabular-nums @4xl:table-cell">
        <time dateTime={document.created_at}>{added}</time>
      </td>
      <td className="py-2 pr-2 pl-0">
        <div className="flex h-(--row-line) items-center justify-end gap-1 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
          <Tooltip content={t('actions.preview')}>
            <Button
              icon
              size="sm"
              variant="ghost"
              aria-label={t('actions.previewOf', { name: document.filename })}
              onClick={() => onPreview(document)}
            >
              <Eye />
            </Button>
          </Tooltip>
          <Tooltip content={t('actions.delete')}>
            <Button
              icon
              size="sm"
              variant="ghost"
              aria-label={t('actions.deleteOf', { name: document.filename })}
              onClick={() => onDelete(document)}
            >
              <Trash2 />
            </Button>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}
