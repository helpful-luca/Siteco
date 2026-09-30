'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DocumentOut } from '@/shared/api/types';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { visibleNotices } from '../status';

/** Second lines under a file name: why it failed, and calm hints that are not errors. */
export function RowDetails({ document }: { document: DocumentOut }) {
  const t = useTranslations('library');
  const text = useCodeText();
  const signature = document.error_params.signature;
  return (
    <>
      {document.status === 'failed' && document.error_code && (
        <p role="note" className="mt-1 text-footnote text-danger">
          {text.error(document.error_code, document.error_params)}
        </p>
      )}
      {document.status === 'failed' && typeof signature === 'string' && signature && (
        <p className="mt-0.5 text-caption text-ink-muted">{t('signature', { signature })}</p>
      )}
      {visibleNotices(document).map((notice) => {
        const message = text.notice(notice.code, notice.params);
        return (
          message && (
            <p key={notice.code} className="mt-1 flex gap-1.5 text-footnote text-ink-muted">
              <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>{message}</span>
            </p>
          )
        );
      })}
    </>
  );
}
