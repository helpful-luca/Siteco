'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ApiError, fetchJson } from '@/shared/api/client';
import type { ReadyOut } from '@/shared/api/types';
import { Button, Spinner } from '@/shared/ui';

/**
 * Polls every 1.5 s. The backend loads the search model before it listens, so for a while the
 * proxy cannot reach it at all; only after this many failed checks (30 s) does the screen say
 * that the server is not running, instead of "starting".
 */
const UNREACHABLE_AFTER_CHECKS = 20;

/** Holds the app back until search works, and explains calmly why it is waiting. */
export function StartupGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations('startup');
  const { data, error, refetch, isFetching, errorUpdateCount } = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: () => fetchJson<ReadyOut>('/api/health/ready'),
    retry: false,
    refetchInterval: (query) => (query.state.data?.ready ? false : 1500),
  });

  if (data?.ready) return <>{children}</>;

  const unavailable =
    error instanceof ApiError &&
    (error.code === 'BACKEND_UNAVAILABLE' || error.code === 'NETWORK_ERROR') &&
    errorUpdateCount >= UNREACHABLE_AFTER_CHECKS;

  return (
    <div role="status" aria-live="polite" className="flex min-h-dvh flex-col items-center px-gutter">
      {/* Optically centered: a little above the middle (2 : 3 spacers). */}
      <div aria-hidden className="min-h-12 flex-2" />
      <div className="flex max-w-96 flex-col items-center text-center">
        {!unavailable && <Spinner label={t('starting')} className="mb-4 size-5" />}
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
      <div aria-hidden className="min-h-12 flex-3" />
    </div>
  );
}
