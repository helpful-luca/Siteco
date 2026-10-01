'use client';

import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/shared/ui';
import { GlobalBanner } from './global-banner';

type Props = {
  /** `page` for lists and tables (1120 px), `reading` for chat and quiet pages (720 px). */
  width?: 'page' | 'reading';
  /** Empty states: the content sits slightly above the middle (2 : 3 spacers), like Apple's. */
  center?: boolean;
  className?: string;
  /** Banners this page shows in its own words (see GlobalBanner `omit`). */
  omitBanners?: readonly string[];
  children: ReactNode;
};

/**
 * The page column inside <main>. Banner, title, toolbar and content share one left edge
 * (`px-gutter`), and the first line starts 12 px below the top like the sidebar's first row.
 */
export function Page({ width = 'page', center = false, className, omitBanners, children }: Props) {
  // The banner stays on top while the page scrolls, on a band of the app's own backdrop that
  // reaches from the window edge to the gap under it, so content disappears behind it. The band's
  // height is --banner-offset: sticky columns under it (the settings list) start and stay below.
  const banner = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const element = banner.current;
    if (!element) return;
    const measure = () => setOffset(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      style={{ '--banner-offset': `${offset}px` } as CSSProperties}
      className={cn(
        'mx-auto flex min-h-full w-full flex-col px-gutter pt-3 pb-16',
        width === 'page' ? 'max-w-[calc(var(--container-page)+2*var(--gutter))]' : 'max-w-[calc(var(--container-reading)+2*var(--gutter))]',
        className,
      )}
    >
      <div ref={banner} className="app-backdrop sticky top-0 z-20 -mt-3 pt-3 pb-6 empty:hidden">
        <GlobalBanner omit={omitBanners} />
      </div>
      {center ? (
        <>
          <div aria-hidden className="min-h-6 flex-2" />
          {children}
          <div aria-hidden className="min-h-6 flex-3" />
        </>
      ) : (
        children
      )}
    </div>
  );
}
