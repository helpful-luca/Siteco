'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { fetchJson } from '@/shared/api/client';
import { useBackendState } from '@/shared/api/use-connection';

/** Pause before each check while the backend is away (annex 10, A10), then every 10 s. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000] as const;
/** While all is well, a quiet health check notices an outage even when nothing else is loading. */
export const HEARTBEAT_MS = 10_000;

/**
 * Notices an outage and brings the app back by itself: a quiet health check every 10 s while
 * the window is visible; while the backend does not answer, checks with a growing pause; once
 * it answers again every query is fetched again, so lists, chats and polling resume where they
 * were. Screen readers hear that the connection is back.
 */
export function ConnectionWatcher() {
  const t = useTranslations('banner');
  const state = useBackendState();
  const client = useQueryClient();
  // Tracked while rendering (not in an effect): was it down, and how often did it come back.
  const [seen, setSeen] = useState(() => ({ state, wasDown: state === 'down', reconnects: 0 }));
  if (seen.state !== state) {
    const back = state === 'up' && seen.wasDown;
    setSeen({
      state,
      wasDown: state === 'down' || (seen.wasDown && state !== 'up'),
      reconnects: seen.reconnects + (back ? 1 : 0),
    });
  }

  useEffect(() => {
    if (state !== 'up') return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchJson('/api/health/live').catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => {
    if (state === 'up') return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const check = () => {
      // At least a second between checks, also while only unsure and when a check changed
      // nothing (an aborted request reports no state); a known outage waits longer each time.
      const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
      attempt += 1;
      timer = setTimeout(() => {
        fetchJson('/api/health/live').catch(() => {
          if (active) check();
        });
      }, delay);
    };
    check();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [state]);

  useEffect(() => {
    if (seen.reconnects > 0) void client.invalidateQueries();
  }, [seen.reconnects, client]);

  return (
    <p aria-live="polite" className="sr-only">
      {seen.reconnects > 0 && state === 'up' ? t('reconnected') : ''}
    </p>
  );
}
