'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DocumentOut } from '@/shared/api/types';
import { Tooltip } from '@/shared/ui';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { visibleNotices } from '../status';

/** Second lines under a file name: why it failed (errors stay visible text). */
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
    </>
  );
}

/** Calm hints that are not errors: one small info icon in the name row, the text on hover and focus. */
export function RowNotices({ document }: { document: DocumentOut }) {
  const text = useCodeText();
  const messages = visibleNotices(document)
    .map((notice) => text.notice(notice.code, notice.params))
    .filter(Boolean);
  if (messages.length === 0) return null;
  const message = messages.join(' ');
  return (
    <Tooltip content={<span className="block max-w-72 text-pretty">{message}</span>}>
      <button
        type="button"
        aria-label={message}
        className="grid size-6 shrink-0 place-items-center rounded-full text-ink-muted outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Info aria-hidden className="size-4" />
      </button>
    </Tooltip>
  );
}
