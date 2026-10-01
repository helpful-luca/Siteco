import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

type Common = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: Variant;
  size?: Size;
};

/** Icon-only buttons must carry an accessible name; the type system enforces it. */
export type ButtonProps =
  | (Common & { icon?: false; children: ReactNode })
  | (Common & { icon: true; 'aria-label': string; children?: ReactNode });

const BASE =
  'inline-flex shrink-0 select-none items-center justify-center gap-1.5 rounded-full font-medium ' +
  'transition-[background-color,box-shadow,transform,filter] duration-150 ease-out-soft ' +
  'active:scale-[0.97] disabled:pointer-events-none [&_svg]:size-4';

/** A disabled primary turns grey: a faded red reads as brown on dark, and as an error elsewhere. */
const PRIMARY_OFF =
  'disabled:bg-fill-strong disabled:text-ink-muted disabled:shadow-none ' +
  'aria-disabled:bg-fill-strong aria-disabled:text-ink-muted aria-disabled:shadow-none ' +
  'aria-disabled:hover:brightness-100 aria-disabled:active:scale-100';
const FADED_OFF = 'disabled:opacity-40';

const VARIANTS: Record<Variant, string> = {
  // Tinted Liquid Glass: the red stays, slightly translucent over a blur, with a light rim on top.
  primary: `bg-accent/85 text-on-accent backdrop-blur-md backdrop-saturate-150 shadow-[inset_0_1px_0_rgb(255_255_255/0.32),inset_0_0_0_1px_rgb(255_255_255/0.1),0_1px_2px_rgb(0_0_0/0.12),0_4px_12px_-6px_rgb(0_0_0/0.25)] hover:bg-accent/92 ${PRIMARY_OFF}`,
  secondary: `bg-fill text-ink ring-1 ring-inset ring-hairline hover:bg-fill-strong ${FADED_OFF}`,
  ghost: `text-ink hover:bg-fill ${FADED_OFF}`,
  danger: `text-danger ring-1 ring-inset ring-hairline hover:bg-fill ${FADED_OFF}`,
};

/**
 * Heights on the 4 px grid: sm 28, md 32 (the toolbar height, same as search fields and
 * segmented controls). On touch screens every button grows to the 44 px minimum target.
 */
const SIZES: Record<Size, { text: string; icon: string }> = {
  sm: { text: 'h-7 px-3 text-footnote pointer-coarse:h-11', icon: 'size-7 pointer-coarse:size-11' },
  md: { text: 'h-8 px-4 text-body pointer-coarse:h-11 pointer-coarse:px-5', icon: 'size-8 pointer-coarse:size-11' },
};

/** Classes of a button, for links that look like one (`<Link className={buttonStyles(...)}>`). */
export function buttonStyles({
  variant = 'secondary',
  size = 'md',
  icon = false,
}: { variant?: Variant; size?: Size; icon?: boolean } = {}): string {
  return cn(BASE, VARIANTS[variant], icon ? SIZES[size].icon : SIZES[size].text);
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      className={cn(buttonStyles({ variant, size, icon }), className)}
      {...rest}
    >
      {children}
    </button>
  );
}
