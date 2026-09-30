import type { DocumentKind } from '@/shared/api/types';
import { cn } from '@/shared/ui';

const LABELS: Record<DocumentKind, string> = { pdf: 'PDF', txt: 'TXT', md: 'MD' };

/** A small page with a folded corner and the file type, like the icons in a Finder list. */
export function FileIcon({ kind, className }: { kind: DocumentKind | null; className?: string }) {
  return (
    <svg viewBox="0 0 24 30" aria-hidden className={cn('h-[30px] w-6 shrink-0', className)}>
      <path
        d="M4 1.5h11l6.5 6.5v18.5A2 2 0 0 1 19.5 28.5h-15.5A2 2 0 0 1 2 26.5v-23A2 2 0 0 1 4 1.5Z"
        className="fill-surface stroke-hairline-strong"
        strokeWidth="1"
      />
      <path d="M15 1.5V6a2 2 0 0 0 2 2h4.5" className="fill-none stroke-hairline-strong" strokeWidth="1" />
      {kind && (
        <text
          x="12"
          y="23.5"
          textAnchor="middle"
          className={cn('fill-ink-muted font-semibold', kind === 'pdf' && 'fill-sodium-ink')}
          style={{ fontSize: 6.5, letterSpacing: 0.2 }}
        >
          {LABELS[kind]}
        </text>
      )}
    </svg>
  );
}
