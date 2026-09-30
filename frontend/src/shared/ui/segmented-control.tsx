'use client';

import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import type { ReactNode } from 'react';
import { cn } from './cn';

export type SegmentOption<T extends string> = { value: T; label: ReactNode };

type Props<T extends string> = {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
};

/** Apple-style segmented control. Radio semantics: one choice, arrow keys move it. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onValueChange,
  className,
}: Props<T>) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      className={cn('inline-flex rounded-control bg-fill p-0.5 ring-1 ring-inset ring-hairline', className)}
    >
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          className={cn(
            'min-w-20 whitespace-nowrap rounded-[8px] px-3 py-1 text-footnote font-medium text-ink-muted',
            'transition-[background-color,color,box-shadow] duration-200 ease-out-soft',
            'hover:text-ink data-checked:bg-surface data-checked:text-ink',
            'data-checked:shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.04)]',
            'dark:data-checked:bg-surface-raised',
          )}
        >
          {option.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
