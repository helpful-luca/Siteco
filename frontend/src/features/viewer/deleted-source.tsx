'use client';

import { FileX } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * A cited source whose document was deleted. Deleting removes the cited text from every answer
 * as well (master spec 10b, 4): the panel says so and shows nothing of the document, also when
 * this window still holds an older copy of the answer.
 */
export function DeletedSource() {
  const t = useTranslations('viewer.source');
  return (
    <div className="flex gap-3 p-6">
      <FileX aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-muted" />
      <div>
        <h3 className="text-body font-medium">{t('deletedTitle')}</h3>
        <p className="mt-1 max-w-[60ch] text-footnote text-ink-muted">{t('deletedText')}</p>
      </div>
    </div>
  );
}
