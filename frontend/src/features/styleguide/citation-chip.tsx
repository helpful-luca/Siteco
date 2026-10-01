import { cn } from '@/shared/ui';

type Props = { n: number; label: string; active?: boolean; onClick?: () => void };

/** Inline source reference. A real button, so it works with keyboard and screen readers. */
export function CitationChip({ n, label, active = false, onClick }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'mx-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-px items-center justify-center rounded-full px-1',
        'align-middle text-[11px] font-semibold leading-none tabular-nums',
        'transition-[background-color,color,box-shadow] duration-200 ease-out-soft',
        active
          ? 'bg-accent text-on-accent'
          : 'bg-fill-strong text-ink hover:bg-accent hover:text-on-accent',
      )}
    >
      {n}
    </button>
  );
}
