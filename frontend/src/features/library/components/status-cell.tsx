'use client';

import { useTranslations } from 'next-intl';
import type { DocumentOut } from '@/shared/api/types';
import { Badge, ProgressBar } from '@/shared/ui';
import { statusView } from '../status';
import type { UploadItem } from '../upload/upload-queue';

/**
 * Screen readers hear stage changes ("Katalog.pdf: bereit"), not every percent step.
 * Only the visible copy of a status announces; hidden duplicates (display: none) stay silent.
 */
function Announcement({ name, stage }: { name: string; stage: string }) {
  const t = useTranslations('library.announce');
  return (
    <span className="sr-only" aria-live="polite">
      {t(stage, { name })}
    </span>
  );
}

export function DocumentStatus({ document, announce = true }: { document: DocumentOut; announce?: boolean }) {
  const t = useTranslations('library.status');
  const view = statusView(document);
  const label = t(view.key, view.values);
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Badge tone={view.tone}>{label}</Badge>
      {view.tone === 'working' && <ProgressBar value={view.progress} label={label} className="w-28" />}
      {announce && <Announcement name={document.filename} stage={view.stage} />}
    </div>
  );
}

export function UploadStatus({ item }: { item: UploadItem }) {
  const t = useTranslations('library.status');
  const name = item.file.name;
  if (item.state === 'failed') {
    return (
      <div>
        <Badge tone="failed">{t('uploadFailed')}</Badge>
        <Announcement name={name} stage="uploadFailed" />
      </div>
    );
  }
  if (item.state === 'waiting') {
    return (
      <div>
        <Badge tone="neutral">{t('uploadWaiting')}</Badge>
        <Announcement name={name} stage="uploadWaiting" />
      </div>
    );
  }
  const share = item.file.size ? item.loaded / item.file.size : 0;
  const label = t('uploading', { percent: Math.round(share * 100) });
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Badge tone="working">{label}</Badge>
      <ProgressBar value={share} label={label} className="w-28" />
      <Announcement name={name} stage="uploading" />
    </div>
  );
}
