'use client';

import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';

export const TooltipProvider = BaseTooltip.Provider;

type Props = {
  content: ReactNode;
  children: ReactElement;
  /** Controlled, for tooltips that only show sometimes (a truncated label). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** Short hint on hover and keyboard focus. Never the only way to learn what something does. */
export function Tooltip({ content, children, open, onOpenChange }: Props) {
  return (
    <BaseTooltip.Root open={open} onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner sideOffset={8}>
          <BaseTooltip.Popup className="glass-dense rounded-control px-2 py-1 text-footnote transition-opacity duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
