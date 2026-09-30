'use client';

import { useTranslations } from 'next-intl';
import type { DocumentOut } from '@/shared/api/types';
import type { UploadItem } from '../upload/upload-queue';
import { DocumentRow } from './document-row';
import { UploadRow } from './upload-row';

type Props = {
  uploads: UploadItem[];
  documents: DocumentOut[];
  onPreview: (document: DocumentOut) => void;
  onDelete: (document: DocumentOut) => void;
  onRetry: (id: string) => void;
  onDismiss: (id: string) => void;
};

/** Finder-style list: file icon and name, status with progress, pages, size, date, actions. */
export function DocumentTable({ uploads, documents, onPreview, onDelete, onRetry, onDismiss }: Props) {
  const t = useTranslations('library.columns');
  const head = 'h-8 px-3 text-left align-middle text-caption font-medium text-ink-muted';
  return (
    <div className="@container overflow-hidden rounded-card bg-surface ring-1 ring-hairline shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      {/*
       * Every cell centers its first line on --row-line (32 px), so file name,
       * badge, numbers and actions share one axis: a one-line row is 48 px (8 + 32 + 8). On touch
       * the 44 px action buttons overhang the line into the 8 px row padding instead of growing it.
       * Columns: 16 px inset from the card edge, 24 px between columns (12 + 12).
       */}
      <table className="w-full table-fixed border-collapse [--row-line:--spacing(8)]">
        <caption className="sr-only">{t('caption')}</caption>
        <thead className="border-b border-hairline">
          <tr>
            <th scope="col" className={`${head} pl-4`}>
              {t('name')}
            </th>
            <th scope="col" className={`${head} hidden w-52 @lg:table-cell`}>
              {t('status')}
            </th>
            <th scope="col" className={`${head} hidden w-20 text-right @3xl:table-cell`}>
              {t('pages')}
            </th>
            <th scope="col" className={`${head} hidden w-28 text-right @3xl:table-cell`}>
              {t('size')}
            </th>
            <th scope="col" className={`${head} hidden w-44 @4xl:table-cell`}>
              {t('added')}
            </th>
            <th scope="col" className={`${head} w-17 pr-2 pl-0 pointer-coarse:w-25`}>
              <span className="sr-only">{t('actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody className="[&>tr:nth-child(even)]:bg-fill/60 [&>tr]:transition-colors [&>tr:hover]:bg-fill-strong/60">
          {uploads.map((item) => (
            <UploadRow key={item.id} item={item} onRetry={onRetry} onDismiss={onDismiss} />
          ))}
          {documents.map((document) => (
            <DocumentRow key={document.id} document={document} onPreview={onPreview} onDelete={onDelete} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
