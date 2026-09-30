'use client';

import { useCallback, useState } from 'react';
import type { ApiError } from '@/shared/api/errors';
import { deadlineIn } from '@/shared/lib/use-countdown';

/** Refusals that only ask for a moment: the composer waits with a countdown (annex 11, 6.3). */
export const WAIT_CODES: ReadonlySet<string> = new Set(['RATE_LIMITED', 'CONCURRENCY_LIMIT']);

export type Refusal = {
  error: ApiError;
  /** Epoch ms until sending makes sense again, for refusals that are only a pause. */
  waitUntil: number | null;
};

/**
 * A question refused before its stream. It stays in the composer (the draft is never cleared
 * here); a pause blocks sending until its countdown is over.
 */
export function useRefusal() {
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [waitOver, setWaitOver] = useState(false);

  const refuse = useCallback((error: ApiError) => {
    const waitUntil = WAIT_CODES.has(error.code) && error.retryAfter ? deadlineIn(error.retryAfter) : null;
    setRefusal({ error, waitUntil });
    setWaitOver(false);
  }, []);
  const clear = useCallback(() => setRefusal(null), []);
  const endWait = useCallback(() => setWaitOver(true), []);

  return {
    refusal,
    refuse,
    clear,
    endWait,
    waiting: Boolean(refusal?.waitUntil) && !waitOver,
  };
}
