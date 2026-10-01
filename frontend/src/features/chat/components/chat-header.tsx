import type { ReactNode } from 'react';

/**
 * Title on the conversation column in the size of a window title, chat level tools (the chat's
 * files) on the right as one group on a glass capsule (macOS 26 toolbars), hidden when empty. Both
 * sit on the sidebar's first-row axis; below 512 px of column width the tools move under the title.
 */
export function ChatHeader({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <header className="@container shrink-0 px-gutter pt-3 pb-2">
      <div className="mx-auto flex max-w-reading flex-col gap-2 @lg:h-8 @lg:flex-row @lg:items-center @lg:justify-between @lg:gap-4">
        {/* A 32 px line box: stacked or in one row, the title centres on the y = 40 axis. */}
        <h1 className="min-w-0 truncate text-body leading-8 font-semibold">{title}</h1>
        <div
          className="glass specular flex w-fit empty:hidden max-w-full min-w-0 shrink-0 items-center gap-0.5 rounded-full p-px [--glass-shadow:var(--c-shadow-tight)]"
        >
          {children}
        </div>
      </div>
    </header>
  );
}
