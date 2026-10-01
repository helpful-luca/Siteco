'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/shared/ui';

type Props = {
  href: '/library' | '/settings';
  icon: ReactNode;
  /** Trailing quiet text, like a mailbox count in Mail. */
  badge?: ReactNode;
  onNavigate?: () => void;
  children: ReactNode;
};

/** Sidebar row in the Finder and Mail style. The current page is marked, not only colored. */
export function NavItem({ href, icon, badge, onNavigate, children }: Props) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center gap-2 rounded-control px-2 text-body transition-colors pointer-coarse:h-11',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        active
          ? 'bg-fill-strong font-medium text-ink [&_svg]:text-ink'
          : 'text-ink/85 hover:bg-fill [&_svg]:opacity-60',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge && <span className="shrink-0 text-footnote font-normal text-ink-muted tabular-nums">{badge}</span>}
    </Link>
  );
}
