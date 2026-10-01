import type { ReactNode } from 'react';
import { cn } from './cn';

/** A keycap for shortcut hints ("⌘K", "esc"): quiet, 20 px, never a control itself. */
export function Kbd({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-fill-strong px-1 font-sans text-caption text-ink-muted tabular-nums',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
