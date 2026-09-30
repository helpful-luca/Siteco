import type { InputHTMLAttributes } from 'react';
import { cn } from './cn';

/** Single-line text field at toolbar height (32 px, 44 px on touch). */
export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-8 rounded-control bg-fill px-3 text-body ring-1 ring-inset ring-hairline outline-none',
        'transition-shadow placeholder:text-ink-muted focus:ring-2 focus:ring-sodium pointer-coarse:h-11',
        className,
      )}
      {...rest}
    />
  );
}
