'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ApiError, fetchJson } from '@/shared/api/client';

type Ready = { ready: boolean };

/** Holds the app back until search works, and explains calmly why it is waiting. */
export function StartupGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations('startup');
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: () => fetchJson<Ready>('/api/health/ready'),
    retry: false,
    refetchInterval: (query) => (query.state.data?.ready ? false : 1500),
  });

  if (data?.ready) return <>{children}</>;

  const unavailable =
    error instanceof ApiError &&
    (error.code === 'BACKEND_UNAVAILABLE' || error.code === 'NETWORK_ERROR');

  return (
    <div role="status" aria-live="polite" className="grid min-h-dvh place-items-center p-8">
      <div className="max-w-sm text-center">
        <p className="text-lg font-medium">{unavailable ? t('unavailable') : t('starting')}</p>
        <p className="mt-2 opacity-70">{unavailable ? t('unavailableHint') : t('startingHint')}</p>
        {unavailable && (
          <button
            type="button"
            className="mt-6 rounded-full px-5 py-2 ring-1 ring-current/20"
            disabled={isFetching}
            onClick={() => refetch()}
          >
            {t('retry')}
          </button>
        )}
      </div>
    </div>
  );
}
