'use client';

import { useTranslations } from 'next-intl';

export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('errors');
  return (
    <main role="alert" className="grid min-h-dvh place-items-center p-8 text-center">
      <div>
        <p className="text-lg font-medium">{t('UNKNOWN_ERROR')}</p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-full px-5 py-2 ring-1 ring-current/20"
        >
          {t('retry')}
        </button>
      </div>
    </main>
  );
}
