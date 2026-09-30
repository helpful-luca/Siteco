'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useDocuments } from '../queries';
import { useFormatSize } from '../use-format-size';
import { RowDetails } from './row-details';
import { DocumentStatus } from './status-cell';

/** Right panel content for one document. Reads the live list, so the status keeps moving. */
export function DocumentDetails({ documentId }: { documentId: string }) {
  const t = useTranslations('library.preview');
  const kinds = useTranslations('library.kind');
  const format = useFormatter();
  const formatSize = useFormatSize();
  const { data } = useDocuments();
  const document = data?.documents.find((d) => d.id === documentId);
  if (!document) return <p className="p-6 text-body text-ink-muted">{t('gone')}</p>;
  const rows: [string, string][] = [
    [t('kind'), kinds(document.kind)],
    [t('pages'), document.page_count === null ? t('noPages') : format.number(document.page_count)],
    [t('size'), formatSize(document.size_bytes)],
    [t('added'), format.dateTime(new Date(document.created_at), { dateStyle: 'long', timeStyle: 'short' })],
  ];
  return (
    <div className="p-6">
      <p className="max-w-[36ch] text-footnote text-ink-muted">{t('notReady')}</p>
      <h3 className="mt-6 text-caption font-medium text-ink-muted">{t('status')}</h3>
      <div className="mt-1 [--row-line:--spacing(7)]">
        <DocumentStatus document={document} announce={false} />
        <RowDetails document={document} />
      </div>
      <h3 className="mt-6 text-caption font-medium text-ink-muted">{t('details')}</h3>
      <dl className="mt-2 divide-y divide-hairline text-footnote">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[1fr_1.4fr] gap-4 py-2">
            <dt className="text-ink-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
