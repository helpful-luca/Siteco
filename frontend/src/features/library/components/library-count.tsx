'use client';

import { useLocale } from 'next-intl';
import { useDocuments } from '../queries';

/** The number of documents in the library, for the sidebar row (like a mailbox count). */
export function LibraryCount() {
  const locale = useLocale();
  const { data } = useDocuments();
  const count = data?.documents.length ?? 0;
  if (count === 0) return null;
  return <>{new Intl.NumberFormat(locale).format(count)}</>;
}
