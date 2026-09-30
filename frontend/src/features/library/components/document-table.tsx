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
  const head = 'py-2 pr-3 text-left text-caption font-medium text-ink-muted';
  return (
    <div className="@container overflow-hidden rounded-card bg-surface ring-1 ring-hairline shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">{t('caption')}</caption>
        <thead className="border-b border-hairline">
          <tr>
            <th scope="col" className={`${head} pl-3 @lg:pl-4`}>
              {t('name')}
            </th>
            <th scope="col" className={`${head} hidden w-44 @lg:table-cell`}>
              {t('status')}
            </th>
            <th scope="col" className={`${head} hidden w-20 pr-4 text-right @2xl:table-cell`}>
              {t('pages')}
            </th>
            <th scope="col" className={`${head} hidden w-24 pr-4 text-right @2xl:table-cell`}>
              {t('size')}
            </th>
            <th scope="col" className={`${head} hidden w-44 @4xl:table-cell`}>
              {t('added')}
            </th>
            <th scope="col" className={`${head} w-[76px] @lg:w-20`}>
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
