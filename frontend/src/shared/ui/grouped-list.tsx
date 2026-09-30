import type { ReactNode } from 'react';
import { cn } from './cn';

type GroupProps = {
  title?: ReactNode;
  /** Fine print below the group: what a setting means, where it comes from. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
};

/**
 * A group of rows on a solid inset card, as in System Settings and iOS Settings: title above,
 * fine print below, rows divided by hairlines that start at the text, not at the card edge.
 */
export function FormGroup({ title, footer, className, children }: GroupProps) {
  return (
    <section className={cn('flex flex-col', className)}>
      {title && <h3 className="px-4 pb-2 text-footnote font-medium text-ink-muted">{title}</h3>}
      <div className="rounded-card bg-surface ring-1 ring-inset ring-hairline">{children}</div>
      {footer && <div className="max-w-[68ch] px-4 pt-2 text-footnote text-ink-muted">{footer}</div>}
    </section>
  );
}

type RowProps = {
  label: ReactNode;
  /** Second line under the label. */
  description?: ReactNode;
  /** Control or value on the right. */
  children?: ReactNode;
  /** Id of the control, so a click on the label focuses it. */
  htmlFor?: string;
  className?: string;
};

/** One line of a FormGroup: label left, control or value right, 48 px high at least. */
export function FormRow({ label, description, children, htmlFor, className }: RowProps) {
  const Label = htmlFor ? 'label' : 'div';
  return (
    <div
      className={cn(
        'relative flex min-h-12 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2',
        'not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-4',
        'not-first:before:h-px not-first:before:bg-hairline',
        className,
      )}
    >
      <Label htmlFor={htmlFor} className="min-w-0 flex-1 basis-48">
        <span className="block text-body">{label}</span>
        {description && <span className="mt-0.5 block text-footnote text-ink-muted">{description}</span>}
      </Label>
      {children !== undefined && <div className="flex max-w-full shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** A plain paragraph row inside a FormGroup, for notices that have no control. */
export function FormText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'relative px-4 py-3 text-body',
        'not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-4',
        'not-first:before:h-px not-first:before:bg-hairline',
        className,
      )}
    >
      {children}
    </div>
  );
}
