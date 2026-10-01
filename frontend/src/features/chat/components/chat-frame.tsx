'use client';

import { ArrowDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { GlobalBanner, RECONNECTING_BANNER } from '@/features/shell';
import { Button } from '@/shared/ui';

type Props = {
  header: ReactNode;
  /** Notice and composer, floating at the bottom. */
  dock: ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  showJump?: boolean;
  /** The list is scrolled away from its top: its edge fades out under the header. */
  scrolled?: boolean;
  onJump?: () => void;
  /** Height of the visible list area, for a last turn that fills the view. */
  onViewHeight?: (height: number) => void;
  children: ReactNode;
};

/** Header, a scrolling conversation column and the floating glass composer over its end. */
export function ChatFrame({
  header,
  dock,
  scrollRef,
  contentRef,
  showJump = false,
  scrolled = false,
  onJump,
  onViewHeight,
  children,
}: Props) {
  const t = useTranslations('chat');
  const dockRef = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(96);

  useEffect(() => {
    const dockElement = dockRef.current;
    const scroller = scrollRef.current;
    if (!dockElement || !scroller) return;
    const observer = new ResizeObserver(() => {
      const height = dockElement.offsetHeight;
      setDockHeight(height);
      // 24 px on top of the list, the dock plus 24 px below it.
      onViewHeight?.(scroller.clientHeight - 24 - height - 24);
    });
    observer.observe(dockElement);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollRef, onViewHeight]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {header}
      {/*
        macOS scroll edge: once the list is scrolled, its top edge fades out over 40 px, so text
        never runs into the title and toolbar. At rest nothing fades (the list starts 24 px lower).
      */}
      <div
        ref={scrollRef}
        data-scrolled={scrolled || undefined}
        className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain px-gutter data-scrolled:[mask-image:linear-gradient(to_bottom,transparent,black_calc(var(--spacing)*10))]"
      >
        <div ref={contentRef} className="mx-auto max-w-reading pt-6" style={{ paddingBottom: dockHeight + 24 }}>
          {/* An outage is told once, in the composer note where the question waits. */}
          <GlobalBanner className="mb-6" omit={[RECONNECTING_BANNER]} />
          {children}
        </div>
      </div>
      <div ref={dockRef} className="pointer-events-none absolute inset-x-0 bottom-0 px-gutter pb-4">
        <div className="relative mx-auto flex max-w-reading flex-col gap-2">
          {showJump && onJump && (
            <Button
              icon
              variant="ghost"
              aria-label={t('jumpToLatest')}
              onClick={onJump}
              className="glass pointer-events-auto absolute -top-12 left-1/2 -translate-x-1/2"
            >
              <ArrowDown />
            </Button>
          )}
          {dock}
        </div>
      </div>
    </div>
  );
}
