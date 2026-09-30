'use client';

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import type { ReactElement, ReactNode } from 'react';
import { cn } from './cn';

type Props = {
  title: string;
  description?: string;
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
};

/** Glass sheet with focus trap, Escape to close and labelled by its title. */
export function Dialog({ title, description, trigger, open, onOpenChange, className, children }: Props) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(next) => onOpenChange?.(next)}>
      {trigger && <BaseDialog.Trigger render={trigger} />}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          className={cn(
            'fixed inset-0 bg-black/20 transition-opacity duration-200 dark:bg-black/50',
            'data-starting-style:opacity-0 data-ending-style:opacity-0',
          )}
        />
        <BaseDialog.Popup
          className={cn(
            'glass-dense fixed top-1/2 left-1/2 w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2',
            'rounded-panel p-6 outline-none',
            'transition-[opacity,scale] duration-200 ease-out-soft',
            'data-starting-style:scale-[0.97] data-starting-style:opacity-0',
            'data-ending-style:scale-[0.97] data-ending-style:opacity-0',
            className,
          )}
        >
          <BaseDialog.Title className="text-title-3 font-semibold">{title}</BaseDialog.Title>
          {description && (
            <BaseDialog.Description className="mt-1 text-body text-ink-muted">
              {description}
            </BaseDialog.Description>
          )}
          <div className="mt-5">{children}</div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export const DialogClose = BaseDialog.Close;
