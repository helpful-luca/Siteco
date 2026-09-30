'use client';

import { useCallback, useState } from 'react';
import type { DocumentOut } from '@/shared/api/types';
import { useTranslations } from 'next-intl';
import { PdfViewer } from './pdf-viewer-client';
import type { PageStore } from './page-store';
import { fileUrl } from './queries';
import { TextViewer } from './text-viewer';

/** Library preview: the whole document from its first page, nothing marked. */
export function DocumentPreview({ document, store }: { document: DocumentOut; store: PageStore }) {
  const t = useTranslations('library.preview');
  const [gone, setGone] = useState(false);
  const onMissing = useCallback(() => setGone(true), []);
  if (gone) return <p className="p-6 text-body text-ink-muted">{t('gone')}</p>;
  if (document.kind !== 'pdf') return <TextViewer documentId={document.id} span={null} onMissing={onMissing} />;
  return <PdfViewer url={fileUrl(document.id)} store={store} page={1} marks={[]} passage={null} onMissing={onMissing} />;
}
