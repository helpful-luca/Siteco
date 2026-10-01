'use client';

import { ArrowDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { GlobalBanner, RECONNECTING_BANNER } from '@/features/shell';
import { Button } from '@/shared/ui';
import { BOTTOM_FADE, scrollEdgeMask } from '../scroll-edge';

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
      // 24 px on top of the list, the dock plus the bottom fade below it.
      onViewHeight?.(scroller.clientHeight - 24 - height - BOTTOM_FADE);
    });
    observer.observe(dockElement);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollRef, onViewHeight]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {header}
      {/*
        `relative` keeps absolutely positioned children (screen reader text) inside this scroller;
        without it they belonged to the frame and made <main> scroll with a visible bar.
        macOS scroll edges: once the list is scrolled, its top edge fades out under the title and
        toolbar; at the bottom it always fades out just above the composer, so no text runs behind
        the glass (where the blur turned it into a bright haze) or shows below the pill.
      */}
      <div
        ref={scrollRef}
        data-scrolled={scrolled || undefined}
        style={{ maskImage: scrollEdgeMask({ scrolled, dockHeight }) }}
        className="@container no-scrollbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-gutter"
      >
        <div ref={contentRef} className="mx-auto max-w-reading pt-6" style={{ paddingBottom: dockHeight + BOTTOM_FADE }}>
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
              className="glass pointer-events-auto absolute -top-12 left-1/2 -translate-x-1/2 transition-[opacity,scale] duration-200 ease-out-soft starting:scale-90 starting:opacity-0"
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
