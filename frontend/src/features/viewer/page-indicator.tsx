'use client';

import { useTranslations } from 'next-intl';
import { usePageState, type PageStore } from './page-store';

/** Panel subtitle that follows the viewer: "Seite 4 von 12". */
export function PageIndicator({ store }: { store: PageStore }) {
  const t = useTranslations('viewer.pdf');
  const { page, pages } = usePageState(store);
  return (
    <span className="tabular-nums" aria-live="off">
      {pages ? t('pageOf', { page, pages }) : t('page', { page })}
    </span>
  );
}
