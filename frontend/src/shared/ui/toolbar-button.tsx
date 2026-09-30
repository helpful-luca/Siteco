import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

/** Toolbar control in the macOS style: quiet text until hovered, 28 px, 44 px on touch. */
export function ToolbarButton({ className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full px-2 text-footnote font-medium text-ink-muted pointer-coarse:h-11',
        'transition-colors hover:bg-fill hover:text-ink data-popup-open:bg-fill data-popup-open:text-ink',
        'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0',
        className,
      )}
      {...rest}
    />
  );
}
