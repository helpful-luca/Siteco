'use client';

import { Progress } from '@base-ui/react/progress';
import { cn } from './cn';

/** Thin determinate bar. `value` is 0..1; `null` shows an indeterminate shimmer. */
export function ProgressBar({
  value,
  label,
  className,
}: {
  value: number | null;
  label: string;
  className?: string;
}) {
  return (
    <Progress.Root
      aria-label={label}
      value={value === null ? null : Math.round(Math.min(Math.max(value, 0), 1) * 100)}
      className={cn('block h-1 w-full overflow-hidden rounded-full bg-fill-strong', className)}
    >
      <Progress.Track className="block h-full w-full">
        <Progress.Indicator
          className={cn(
            'block h-full rounded-full bg-sodium transition-[width] duration-500 ease-out-soft',
            value === null && 'w-1/3 animate-[progress-sweep_1.4s_ease-in-out_infinite]',
          )}
        />
      </Progress.Track>
    </Progress.Root>
  );
}
