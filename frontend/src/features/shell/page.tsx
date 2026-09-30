import type { ReactNode } from 'react';
import { cn } from '@/shared/ui';
import { GlobalBanner } from './global-banner';

type Props = {
  /** `page` for lists and tables (1120 px), `reading` for chat and quiet pages (720 px). */
  width?: 'page' | 'reading';
  /** Empty states: the content sits slightly above the middle (2 : 3 spacers), like Apple's. */
  center?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * The page column inside <main>. Banner, title, toolbar and content share one left edge
 * (`px-gutter`), and the first line starts 12 px below the top like the sidebar's first row.
 */
export function Page({ width = 'page', center = false, className, children }: Props) {
  return (
    <div
      className={cn(
        'mx-auto flex min-h-full w-full flex-col px-gutter pt-3 pb-16',
        width === 'page' ? 'max-w-[calc(var(--container-page)+2*var(--gutter))]' : 'max-w-[calc(var(--container-reading)+2*var(--gutter))]',
        className,
      )}
    >
      <GlobalBanner className="mb-6" />
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
