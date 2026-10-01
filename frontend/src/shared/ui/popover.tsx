'use client';

import { Popover as BasePopover } from '@base-ui/react/popover';
import type { ReactElement, ReactNode } from 'react';
import { cn } from './cn';

type PopoverProps = {
  trigger: ReactElement;
  /** Accessible name of the panel; shown as its heading. */
  title: string;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom';
  className?: string;
  children: ReactNode;
};

/**
 * A small panel anchored to a button, in the same dense glass as menus (like the attachment
 * popover in Mail). Unlike a menu it holds rows with their own buttons; Escape closes it and
 * focus returns to the trigger.
 */
export function Popover({ trigger, title, align = 'end', side = 'bottom', className, children }: PopoverProps) {
  return (
    <BasePopover.Root>
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner sideOffset={6} align={align} side={side} className="z-50 outline-none">
          <BasePopover.Popup
            className={cn(
              'glass-dense flex max-h-[min(28rem,70dvh)] w-80 max-w-[calc(100vw-2rem)] origin-(--transform-origin) flex-col rounded-card outline-none',
              'transition-[opacity,scale] duration-150 ease-out-soft',
              'data-starting-style:scale-[0.97] data-starting-style:opacity-0 data-ending-style:opacity-0',
              className,
            )}
          >
            <BasePopover.Title className="px-3 pt-3 pb-1 text-footnote font-semibold">{title}</BasePopover.Title>
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
