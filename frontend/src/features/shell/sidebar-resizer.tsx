'use client';

import { useTranslations } from 'next-intl';
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';
import { cn } from '@/shared/ui';
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from './sidebar-layout';
import { useUI } from './ui-context';

const STEP = 16;

/**
 * The sidebar's right edge: drag to resize (224 to 360 px), double click for the default width,
 * arrow keys in 16 px steps when focused. A hairline shows in the gap while hovered or dragged.
 */
export function SidebarResizer({ onResizingChange }: { onResizingChange: (resizing: boolean) => void }) {
  const t = useTranslations('shell');
  const { sidebarWidth, setSidebarWidth } = useUI();
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; width: number } | null>(null);

  const setDrag = (value: boolean) => {
    setDragging(value);
    onResizingChange(value);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width: sidebarWidth };
    setDrag(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    setSidebarWidth(start.current.width + event.clientX - start.current.x);
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    setSidebarWidth(start.current.width + event.clientX - start.current.x, true);
    start.current = null;
    setDrag(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === 'ArrowLeft'
        ? sidebarWidth - STEP
        : event.key === 'ArrowRight'
          ? sidebarWidth + STEP
          : event.key === 'Home'
            ? SIDEBAR_MIN
            : event.key === 'End'
              ? SIDEBAR_MAX
              : null;
    if (next === null) return;
    event.preventDefault();
    setSidebarWidth(next, true);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('resize')}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={sidebarWidth}
      tabIndex={0}
      data-no-drag=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT, true)}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-6 -right-3 z-10 flex w-3 cursor-col-resize touch-none justify-center outline-none"
    >
      <span
        aria-hidden
        className={cn(
          'h-full w-0.5 rounded-full transition-colors duration-150',
          dragging ? 'bg-hairline-strong' : 'bg-transparent group-hover:bg-hairline-strong group-focus-visible:bg-accent',
        )}
      />
    </div>
  );
}
