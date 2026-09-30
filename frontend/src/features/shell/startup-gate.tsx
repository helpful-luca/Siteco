'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ApiError, fetchJson } from '@/shared/api/client';
import type { ReadyOut } from '@/shared/api/types';
import { Button, Spinner } from '@/shared/ui';

/** Holds the app back until search works, and explains calmly why it is waiting. */
export function StartupGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations('startup');
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: () => fetchJson<ReadyOut>('/api/health/ready'),
    retry: false,
    refetchInterval: (query) => (query.state.data?.ready ? false : 1500),
  });

  if (data?.ready) return <>{children}</>;

  const unavailable =
    error instanceof ApiError &&
    (error.code === 'BACKEND_UNAVAILABLE' || error.code === 'NETWORK_ERROR');

  return (
    <div role="status" aria-live="polite" className="grid min-h-dvh place-items-center p-8">
      <div className="flex max-w-sm flex-col items-center text-center">
        {!unavailable && <Spinner label={t('starting')} className="mb-5 size-5" />}
        <p className="text-title-3 font-semibold">{unavailable ? t('unavailable') : t('starting')}</p>
        <p className="mt-2 text-body text-ink-muted">
          {unavailable ? t('unavailableHint') : t('startingHint')}
        </p>
        {unavailable && (
          <Button className="mt-6" disabled={isFetching} onClick={() => refetch()}>
            {t('retry')}
          </Button>
        )}
      </div>
    </div>
  );
}
