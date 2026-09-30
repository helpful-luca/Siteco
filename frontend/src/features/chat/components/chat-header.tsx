import type { ReactNode } from 'react';

/**
 * Title on the conversation column, toolbar on the right, on the sidebar's first-row axis. Below
 * 512 px of column width (phones, or an open side panel) the toolbar moves under the title.
 */
export function ChatHeader({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <header className="@container shrink-0 px-gutter pt-3 pb-2">
      <div className="mx-auto flex max-w-reading flex-col gap-1 @lg:h-8 @lg:flex-row @lg:items-center @lg:justify-between @lg:gap-4">
        <h1 className="min-w-0 truncate text-title-3 font-semibold">{title}</h1>
        <div className="-ml-2 flex min-w-0 shrink-0 items-center gap-1 @lg:-mr-2 @lg:ml-0">{children}</div>
      </div>
    </header>
  );
}
