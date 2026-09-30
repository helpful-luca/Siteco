'use client';

import { Info } from 'lucide-react';
import type { NoticeOut } from '@/shared/api/types';
import { useConfig } from '@/shared/api/use-config';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { modelLabel } from '../format';

/** Hints that are no errors, as calm notes: an icon and one or two lines of muted text. */
export function AnswerNotices({ notices }: { notices: NoticeOut[] }) {
  const text = useCodeText();
  const { data: config } = useConfig();
  const shown = notices.flatMap((notice) => {
    const params = Object.fromEntries(
      Object.entries(notice.params ?? {}).map(([key, value]) => [
        key,
        notice.code === 'MODEL_SWITCHED' ? modelLabel(config?.models, String(value)) : value,
      ]),
    );
    const message = text.notice(notice.code, params);
    return message ? [{ code: notice.code, message }] : [];
  });
  if (shown.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {shown.map((notice) => (
        <li key={notice.code} className="flex max-w-[68ch] gap-2 text-footnote text-ink-muted">
          <Info aria-hidden className="mt-px size-4 shrink-0 opacity-70" />
          <span>{notice.message}</span>
        </li>
      ))}
    </ul>
  );
}
