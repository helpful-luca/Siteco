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
  'inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-full font-medium ' +
  'transition-[background-color,box-shadow,transform,filter] duration-150 ease-out-soft ' +
  'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-sodium text-on-sodium shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_1px_2px_rgb(0_0_0/0.15)] hover:brightness-[1.06]',
  secondary: 'bg-fill text-ink ring-1 ring-inset ring-hairline hover:bg-fill-strong',
  ghost: 'text-ink hover:bg-fill',
  danger: 'text-danger ring-1 ring-inset ring-hairline hover:bg-fill',
};

const SIZES: Record<Size, { text: string; icon: string }> = {
  sm: { text: 'h-7 px-3 text-footnote', icon: 'size-7' },
  md: { text: 'h-9 px-4 text-body', icon: 'size-9' },
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
