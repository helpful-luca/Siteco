'use client';

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { useRef, type ReactNode } from 'react';
import { cn } from './cn';

type Props = {
  side: 'left' | 'right';
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  children: ReactNode;
};

/** A panel that slides in from the edge on narrow windows. Modal: focus trap, Escape closes. */
export function SideSheet({ side, label, open, onOpenChange, className, children }: Props) {
  // Focus lands on the sheet itself, not on its first field: Tab moves on from there.
  const popup = useRef<HTMLDivElement>(null);
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-black/20 transition-opacity duration-300 data-starting-style:opacity-0 data-ending-style:opacity-0 dark:bg-black/50" />
        <BaseDialog.Popup
          ref={popup}
          initialFocus={popup}
          aria-label={label}
          className={cn(
            // Below the desktop window's buttons (--window-top), so they stay visible and usable.
            'fixed top-[calc(var(--sheet-inset)+var(--window-top))] bottom-(--sheet-inset) z-50 flex outline-none',
            'transition-[translate,opacity] duration-300 ease-out-soft',
            'data-starting-style:opacity-0 data-ending-style:opacity-0',
            side === 'left'
              ? 'left-(--sheet-inset) data-starting-style:-translate-x-6 data-ending-style:-translate-x-6'
              : 'right-(--sheet-inset) data-starting-style:translate-x-6 data-ending-style:translate-x-6',
            className,
          )}
        >
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
