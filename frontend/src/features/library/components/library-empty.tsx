'use client';

import { FileUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/shared/ui';

/** 1024 MB reads better as 1 GB. */
function uploadLimit(mb: number): string {
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;
}

/** First visit: one clear invitation to upload, by button or by dropping anywhere. */
export function LibraryEmpty({
  maxUploadMb,
  onChoose,
  onLink,
}: {
  maxUploadMb?: number;
  onChoose: () => void;
  onLink: () => void;
}) {
  const t = useTranslations('library.empty');
  const tImport = useTranslations('library.import');
  return (
    <div className="flex flex-col items-center rounded-panel border border-dashed border-hairline-strong px-6 py-16 text-center sm:py-20">
      <div className="grid size-14 place-items-center rounded-full bg-highlight text-accent-ink">
        <FileUp aria-hidden className="size-6" />
      </div>
      <h2 className="mt-4 text-title-3 font-semibold">{t('title')}</h2>
      <p className="mt-2 max-w-[44ch] text-body text-ink-muted">{t('text')}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={onChoose}>
          {t('choose')}
        </Button>
        <Button onClick={onLink}>{tImport('link')}</Button>
      </div>
      <p className="mt-4 max-w-[48ch] text-caption text-ink-muted">
        {maxUploadMb ? t('hint', { limit: uploadLimit(maxUploadMb) }) : t('hintNoLimit')}
      </p>
    </div>
  );
}
