'use client';

import { Search, X } from 'lucide-react';
import type { InputHTMLAttributes } from 'react';
import { cn } from './cn';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> & {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  clearLabel?: string;
  /** Key hint shown while the field is empty and unfocused ("⌘K"); hidden on touch screens. */
  shortcut?: string | null;
};

/** Search input in the macOS style: a quiet filled field with a leading glass icon. */
export function SearchField({ label, value, onValueChange, clearLabel, shortcut, className, ...rest }: Props) {
  return (
    <label
      className={cn(
        'group flex h-8 min-w-0 cursor-text items-center gap-2 rounded-control bg-fill px-2 text-ink-muted pointer-coarse:h-11',
        'focus-within:ring-2 focus-within:ring-accent/60',
        className,
      )}
    >
      <Search aria-hidden className="size-4 shrink-0" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={label}
        className="w-full min-w-0 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted [&::-webkit-search-cancel-button]:hidden"
        {...rest}
      />
      {shortcut && !value && (
        <kbd
          aria-hidden
          className="shrink-0 font-sans text-caption text-ink-muted/80 tabular-nums group-focus-within:hidden pointer-coarse:hidden"
        >
          {shortcut}
        </kbd>
      )}
      {value && clearLabel && (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onValueChange('')}
          className={cn(
            'relative grid size-4 shrink-0 place-items-center rounded-full bg-ink-muted/60 text-surface hover:bg-ink-muted',
            // Invisible hit area: 32 px with a mouse, 44 px on touch.
            'after:absolute after:-inset-2 pointer-coarse:after:-inset-3.5',
          )}
        >
          <X aria-hidden className="size-2.5" strokeWidth={3} />
        </button>
      )}
    </label>
  );
}
