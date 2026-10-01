'use client';

import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { useId } from 'react';
import { cn } from './cn';

type Props = {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  className?: string;
};

export function Switch({ label, checked, onCheckedChange, disabled, hideLabel, className }: Props) {
  const labelId = useId();
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <BaseSwitch.Root
        aria-labelledby={labelId}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next)}
        disabled={disabled}
        className={cn(
          'relative inline-flex h-7 w-12 shrink-0 rounded-full bg-fill-strong p-0.5',
          'transition-colors duration-200 ease-out-soft data-checked:bg-accent',
          // Hit area 64 x 44 on touch, the track stays 48 x 28.
          'pointer-coarse:after:absolute pointer-coarse:after:-inset-x-2 pointer-coarse:after:-inset-y-2',
          'data-disabled:opacity-40',
        )}
      >
        <BaseSwitch.Thumb
          className={cn(
            'size-6 rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.25)]',
            'transition-transform duration-200 ease-out-soft data-checked:translate-x-5',
          )}
        />
      </BaseSwitch.Root>
      <span id={labelId} className={cn('text-body', hideLabel && 'sr-only')}>
        {label}
      </span>
    </span>
  );
}
