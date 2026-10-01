import { cn } from '@/shared/ui';

/**
 * A value from 0 to 1 as a quiet horizontal bar under its number. The number carries the meaning;
 * the bar is decoration for comparing rows at a glance.
 */
export function ShareBar({ value, accent = false, className }: { value: number; accent?: boolean; className?: string }) {
  const width = `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
  return (
    <span aria-hidden className={cn('block h-1 w-full overflow-hidden rounded-full bg-fill-strong', className)}>
      <span className={cn('block h-full rounded-full', accent ? 'bg-sodium' : 'bg-ink-muted/60')} style={{ width }} />
    </span>
  );
}
