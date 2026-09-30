'use client';

import { useTranslations } from 'next-intl';
import type { DocumentOut } from '@/shared/api/types';
import { Badge, ProgressBar } from '@/shared/ui';
import { statusView } from '../status';
import type { UploadItem } from '../upload/upload-queue';

export function DocumentStatus({ document }: { document: DocumentOut }) {
  const t = useTranslations('library.status');
  const view = statusView(document);
  const label = t(view.key, view.values);
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Badge tone={view.tone}>{label}</Badge>
      {view.tone === 'working' && <ProgressBar value={view.progress} label={label} className="w-28" />}
    </div>
  );
}

export function UploadStatus({ item }: { item: UploadItem }) {
  const t = useTranslations('library.status');
  if (item.state === 'failed') return <Badge tone="failed">{t('uploadFailed')}</Badge>;
  if (item.state === 'waiting') return <Badge tone="neutral">{t('uploadWaiting')}</Badge>;
  const share = item.file.size ? item.loaded / item.file.size : 0;
  const label = t('uploading', { percent: Math.round(share * 100) });
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Badge tone="working">{label}</Badge>
      <ProgressBar value={share} label={label} className="w-28" />
    </div>
  );
}
