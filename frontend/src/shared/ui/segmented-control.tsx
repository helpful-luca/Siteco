'use client';

import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { MotionConfig, motion } from 'motion/react';
import { type ReactNode, useId } from 'react';
import { cn } from './cn';

/** The selection glides to the new segment: a spring without overshoot, like macOS. */
const GLIDE = { type: 'spring', duration: 0.32, bounce: 0 } as const;

export type SegmentOption<T extends string> = { value: T; label: ReactNode };

type Props<T extends string> = {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
};

/**
 * Apple-style segmented control. Radio semantics: one choice, arrow keys move it. One shared
 * indicator slides between the segments (Motion `layoutId`); with reduced motion it jumps.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onValueChange,
  className,
}: Props<T>) {
  const indicator = useId();
  return (
    <MotionConfig reducedMotion="user">
      <RadioGroup
        aria-label={label}
        value={value}
        onValueChange={(next) => onValueChange(next as T)}
        className={cn(
          'inline-flex h-8 rounded-control bg-fill p-0.5 ring-1 ring-inset ring-hairline pointer-coarse:h-11',
          className,
        )}
      >
        {options.map((option) => (
          <Radio.Root
            key={option.value}
            value={option.value}
            className={cn(
              'relative inline-flex min-w-20 items-center justify-center whitespace-nowrap px-3 text-footnote font-medium text-ink-muted',
              'rounded-[calc(var(--radius-control)-2px)] transition-colors duration-200 ease-out-soft',
              'hover:text-ink data-checked:text-ink',
            )}
          >
            {option.value === value && (
              <motion.span
                layoutId={indicator}
                transition={GLIDE}
                data-segment-indicator=""
                className={cn(
                  'absolute inset-0 rounded-[inherit] bg-surface dark:bg-surface-raised',
                  'shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.04)]',
                )}
              />
            )}
            <span className="relative">{option.label}</span>
          </Radio.Root>
        ))}
      </RadioGroup>
    </MotionConfig>
  );
}
