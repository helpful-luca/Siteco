import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { buttonStyles } from '@/shared/ui/button';

/** An address that does not exist: the calm screen with the way back. */
export default async function NotFound() {
  const t = await getTranslations('errors');
  return (
    <main className="flex min-h-dvh flex-col px-gutter">
      <div aria-hidden className="min-h-12 flex-2" />
      <div className="mx-auto flex w-full max-w-reading flex-col items-start">
        <h1 className="text-title-2 font-semibold">{t('pageNotFound')}</h1>
        <Link href="/chat" className={`${buttonStyles({ variant: 'primary' })} mt-6`}>
          {t('goHome')}
        </Link>
      </div>
      <div aria-hidden className="min-h-12 flex-3" />
    </main>
  );
}
