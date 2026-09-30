'use client';

import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';

/**
 * A small preview on hover and keyboard focus (citation chips). Built on the tooltip, so it opens
 * on focus as well; the trigger keeps its own accessible name and action.
 */
export function HoverCard({ content, children }: { content: ReactNode; children: ReactElement }) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger delay={150} render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner sideOffset={8} collisionPadding={12} className="z-50">
          <BaseTooltip.Popup className="glass-dense w-[min(20rem,calc(100vw-var(--spacing)*6))] rounded-card p-4 transition-opacity duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0">
            {content}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
