'use client';

import { useCallback, useSyncExternalStore } from 'react';

const CHECK_MS = 250;

const still = () => () => undefined;

function ticking(onChange: () => void): () => void {
  const timer = setInterval(onChange, CHECK_MS);
  return () => clearInterval(timer);
}

/**
 * Whole seconds left until `until` (epoch ms), rounded up; 0 once it passed or without one.
 * The value only changes once per second, so components re-render once per second too.
 */
export function useCountdown(until: number | null): number {
  const read = useCallback(
    () => (until === null ? 0 : Math.max(0, Math.ceil((until - Date.now()) / 1000))),
    [until],
  );
  return useSyncExternalStore(until === null ? still : ticking, read, () => 0);
}

/** The moment a `retry_after` in seconds ends, for `useCountdown`. */
export function deadlineIn(seconds: number, from = Date.now()): number {
  return from + seconds * 1000;
}
