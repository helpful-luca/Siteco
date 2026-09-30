'use client';

import { useEffect, useRef, useState } from 'react';
import { useCountdown } from '@/shared/lib/use-countdown';

type Props = {
  /** Epoch milliseconds when the wait is over. */
  until: number;
  /** The sentence for a number of seconds left. */
  format: (seconds: number) => string;
  /** Shown and announced once the wait is over. */
  done: string;
  onEnd?: () => void;
};

/**
 * A wait with visible seconds. Screen readers hear it twice only: when it starts (with the
 * seconds at that moment) and when it is over, never every tick (annex 11, 6.3).
 */
export function Countdown({ until, format, done, onEnd }: Props) {
  const seconds = useCountdown(until);
  const ended = seconds === 0;
  const [start] = useState(() => format(seconds));
  const [announced, setAnnounced] = useState('');
  const endRef = useRef(onEnd);
  useEffect(() => {
    endRef.current = onEnd;
  });

  // Filled a moment after mounting: text already present when a live region appears is not read.
  useEffect(() => {
    const timer = setTimeout(() => setAnnounced(ended ? done : start), 50);
    return () => clearTimeout(timer);
  }, [ended, done, start]);

  useEffect(() => {
    if (ended) endRef.current?.();
  }, [ended]);

  return (
    <>
      <span aria-hidden="true" className="tabular-nums">
        {ended ? done : format(seconds)}
      </span>
      <span className="sr-only" aria-live="polite">
        {announced}
      </span>
    </>
  );
}
