import type { ReactNode } from 'react';

/**
 * Title on the conversation column in the size of a window title, the toolbar on the right as one
 * group on a glass capsule (macOS 26 toolbars), both on the sidebar's first-row axis. Below 512 px
 * of column width (phones, or an open side panel) the toolbar moves under the title.
 */
export function ChatHeader({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <header className="@container shrink-0 px-gutter pt-3 pb-2">
      <div className="mx-auto flex max-w-reading flex-col gap-2 @lg:h-8 @lg:flex-row @lg:items-center @lg:justify-between @lg:gap-4">
        {/* A 32 px line box: stacked or in one row, the title centres on the y = 40 axis. */}
        <h1 className="min-w-0 truncate text-body leading-8 font-semibold">{title}</h1>
        <div
          className="glass specular flex w-fit max-w-full min-w-0 shrink-0 items-center gap-0.5 rounded-full p-0.5 [--glass-shadow:var(--c-shadow-tight)]"
        >
          {children}
        </div>
      </div>
    </header>
  );
}
