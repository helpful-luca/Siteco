import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('errors');
  return (
    <main className="grid min-h-dvh place-items-center p-8 text-center">
      <div>
        <p className="text-lg font-medium">{t('NOT_FOUND')}</p>
        <Link href="/" className="mt-4 inline-block underline underline-offset-4">
          {t('goHome')}
        </Link>
      </div>
    </main>
  );
}
