'use client';

import { Eye, Trash2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { DocumentOut } from '@/shared/api/types';
import { Button, Tooltip } from '@/shared/ui';
import { useFormatSize } from '../use-format-size';
import { FileIcon } from './file-icon';
import { FileName } from './file-name';
import { RowDetails } from './row-details';
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
      <td className="py-2.5 pr-3 pl-3 @lg:pl-4">
        <div className="flex gap-3">
          <FileIcon kind={document.kind} />
          <div className="min-w-0 flex-1 pt-[3px]">
            <FileName name={document.filename} />
            <p className="text-caption text-ink-muted @2xl:hidden">
              {pages === null ? size : t('meta', { pages: document.page_count ?? 0, size })}
            </p>
            <div className="mt-1.5 @lg:hidden">
              <DocumentStatus document={document} />
            </div>
            <RowDetails document={document} />
          </div>
        </div>
      </td>
      <td className="hidden py-3 pr-3 @lg:table-cell">
        <DocumentStatus document={document} />
      </td>
      <td className="hidden py-3 pr-4 text-right text-footnote text-ink-muted tabular-nums @2xl:table-cell">
        {pages ?? <span aria-label={t('noPages')}>--</span>}
      </td>
      <td className="hidden py-3 pr-4 text-right text-footnote text-ink-muted tabular-nums whitespace-nowrap @2xl:table-cell">
        {size}
      </td>
      <td className="hidden py-3 pr-3 text-footnote text-ink-muted whitespace-nowrap @4xl:table-cell">
        <time dateTime={document.created_at}>{added}</time>
      </td>
      <td className="py-2 pr-2 @lg:pr-3">
        <div className="flex justify-end gap-0.5 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
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
