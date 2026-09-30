import type { ReactNode } from 'react';
import { cn } from './cn';

type Tone = 'neutral' | 'working' | 'ready' | 'failed';

const TONES: Record<Tone, string> = {
  neutral: 'text-ink-muted bg-fill',
  working: 'text-sodium-ink bg-highlight',
  ready: 'text-success bg-fill',
  failed: 'text-danger bg-fill',
};

const DOTS: Record<Tone, string> = {
  neutral: 'bg-ink-muted',
  working: 'bg-sodium animate-pulse',
  ready: 'bg-success',
  failed: 'bg-danger',
};

/** Status pill. The text carries the meaning; the dot only repeats it. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-caption font-medium',
        TONES[tone],
      )}
    >
      <span aria-hidden className={cn('size-1.5 rounded-full', DOTS[tone])} />
      {children}
    </span>
  );
}
