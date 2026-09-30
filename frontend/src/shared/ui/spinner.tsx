import { cn } from './cn';

/** Without a label the spinner is decoration (the text next to it says what is happening). */
export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <svg
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      viewBox="0 0 16 16"
      className={cn('size-4 animate-spin text-ink-muted', className)}
    >
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
