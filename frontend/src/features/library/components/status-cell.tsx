'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
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

/**
 * The badge sits centered on the row's first line (`--row-line`, set by the table or the panel),
 * so it shares one axis with the file name and the numbers. The bar hangs right below that line.
 */
function StatusStack({ badge, progress = null, children }: { badge: ReactNode; progress?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start">
      <div className="flex min-h-(--row-line) items-center">{badge}</div>
      {progress}
      {children}
    </div>
  );
}

export function DocumentStatus({ document, announce = true }: { document: DocumentOut; announce?: boolean }) {
  const t = useTranslations('library.status');
  const view = statusView(document);
  const label = t(view.key, view.values);
  return (
    <StatusStack
      badge={<Badge tone={view.tone}>{label}</Badge>}
      progress={view.tone === 'working' ? <ProgressBar value={view.progress} label={label} className="w-28" /> : null}
    >
      {announce && <Announcement name={document.filename} stage={view.stage} />}
    </StatusStack>
  );
}

export function UploadStatus({ item }: { item: UploadItem }) {
  const t = useTranslations('library.status');
  const name = item.file.name;
  if (item.state === 'failed' && item.error?.code === 'RATE_LIMITED') {
    return (
      <StatusStack badge={<Badge tone="neutral">{t('uploadPaused')}</Badge>}>
        <Announcement name={name} stage="uploadPaused" />
      </StatusStack>
    );
  }
  if (item.state === 'failed') {
    return (
      <StatusStack badge={<Badge tone="failed">{t('uploadFailed')}</Badge>}>
        <Announcement name={name} stage="uploadFailed" />
      </StatusStack>
    );
  }
  if (item.state === 'waiting') {
    return (
      <StatusStack badge={<Badge tone="neutral">{t('uploadWaiting')}</Badge>}>
        <Announcement name={name} stage="uploadWaiting" />
      </StatusStack>
    );
  }
  const share = item.file.size ? item.loaded / item.file.size : 0;
  const label = t('uploading', { percent: Math.round(share * 100) });
  return (
    <StatusStack
      badge={<Badge tone="working">{label}</Badge>}
      progress={<ProgressBar value={share} label={label} className="w-28" />}
    >
      <Announcement name={name} stage="uploading" />
    </StatusStack>
  );
}
