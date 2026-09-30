'use client';

import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { DocumentOut } from '@/shared/api/types';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { ApiError } from '@/shared/api/errors';
import { useConfig } from '@/shared/api/use-config';
import { Page, useUI } from '@/features/shell';
import { useOpenDocument } from '@/features/viewer';
import { Button, DelayedSpinner, SearchField, SegmentedControl } from '@/shared/ui';
import { useDeleteDocument, useDocuments } from '../queries';
import { matchesFilter, matchesQuery, statusGroup, type StatusFilter } from '../status';
import { useUploads } from '../upload/upload-provider';
import { useFormatSize } from '../use-format-size';
import { DeleteDialog } from './delete-dialog';
import { DocumentDetails } from './document-details';
import { DocumentTable } from './document-table';
import { LibraryEmpty } from './library-empty';

const FILTERS: StatusFilter[] = ['all', 'ready', 'working', 'failed'];

export function LibraryView() {
  const t = useTranslations('library');
  const text = useCodeText();
  const formatSize = useFormatSize();
  const { data, error, isPending, refetch, isFetching } = useDocuments();
  const { data: config } = useConfig();
  const uploads = useUploads();
  const remove = useDeleteDocument();
  const { openPanel, panel, closePanel } = useUI();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [deleting, setDeleting] = useState<DocumentOut | null>(null);

  const documents = data?.documents ?? [];
  const shownDocuments = documents.filter(
    (d) => matchesQuery(d.filename, query) && matchesFilter(statusGroup(d.status), filter),
  );
  const shownUploads = uploads.items.filter(
    (i) => matchesQuery(i.file.name, query) && matchesFilter(i.state === 'failed' ? 'failed' : 'working', filter),
  );
  const empty = documents.length === 0 && uploads.items.length === 0;
  const totalBytes = documents.reduce((sum, d) => sum + d.size_bytes, 0);

  const openDocument = useOpenDocument();
  // Ready documents open in the viewer; the others show their status until they can be read.
  const preview = (document: DocumentOut) =>
    document.status === 'ready'
      ? openDocument(document)
      : openPanel({
          id: document.id,
          title: document.filename,
          subtitle: t('preview.title'),
          body: <DocumentDetails documentId={document.id} />,
        });

  const confirmDelete = (document: DocumentOut) => {
    if (panel?.id === document.id) closePanel();
    remove.mutate(document.id);
  };

  return (
    <Page>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-title-2 font-semibold">{t('title')}</h1>
          <p className="mt-1 text-footnote text-ink-muted" aria-live="polite">
            {data ? t('summary', { count: documents.length, size: formatSize(totalBytes) }) : ' '}
          </p>
        </div>
        {!empty && (
          <Button variant="primary" onClick={uploads.openPicker}>
            <Upload aria-hidden />
            {t('upload')}
          </Button>
        )}
      </header>

      {remove.error && (
        <p role="alert" className="mt-3 text-footnote text-danger">
          {text.error(remove.error instanceof ApiError ? remove.error.code : 'UNKNOWN_ERROR')}
        </p>
      )}

      {isPending ? (
        <div className="grid place-items-center py-24">
          <DelayedSpinner label={t('loading')} className="size-5" />
        </div>
      ) : error && !data ? (
        <div role="alert" className="mt-6 flex flex-col items-start gap-3">
          <p className="text-body">{text.error(error instanceof ApiError ? error.code : 'UNKNOWN_ERROR')}</p>
          <Button disabled={isFetching} onClick={() => refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : empty ? (
        <div className="mt-6">
          <LibraryEmpty maxUploadMb={config?.limits.max_upload_mb} onChoose={uploads.openPicker} />
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <SearchField
              label={t('search')}
              clearLabel={t('clearSearch')}
              value={query}
              onValueChange={setQuery}
              className="w-full sm:w-64"
            />
            <SegmentedControl
              label={t('filter.label')}
              value={filter}
              onValueChange={setFilter}
              options={FILTERS.map((value) => ({ value, label: t(`filter.${value}`) }))}
              className="w-full sm:w-auto [&>*]:min-w-0 [&>*]:flex-1 sm:[&>*]:min-w-20 sm:[&>*]:flex-none"
            />
          </div>
          <div className="mt-3">
            {shownDocuments.length + shownUploads.length > 0 ? (
              <DocumentTable
                uploads={shownUploads}
                documents={shownDocuments}
                onPreview={preview}
                onDelete={setDeleting}
                onRetry={uploads.retry}
                onDismiss={uploads.dismiss}
              />
            ) : (
              <div className="px-6 py-16 text-center">
                <p className="text-body font-medium">{t('noResults.title')}</p>
                <p className="mt-1 text-footnote text-ink-muted">
                  {query.trim() ? t('noResults.text', { query: query.trim() }) : t('noResults.textFilter')}
                </p>
                <Button
                  size="sm"
                  className="mt-4"
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                >
                  {t('noResults.reset')}
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      <DeleteDialog document={deleting} onConfirm={confirmDelete} onClose={() => setDeleting(null)} />
    </Page>
  );
}
