'use client';

import { useEffect, useState } from 'react';
import { Spinner } from './spinner';

/** Appears only if loading takes longer than `delayMs`, so fast loads never flicker (annex 10, O1). */
export function DelayedSpinner({ label, delayMs = 300, className }: { label: string; delayMs?: number; className?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  return visible ? <Spinner label={label} className={className} /> : null;
}
