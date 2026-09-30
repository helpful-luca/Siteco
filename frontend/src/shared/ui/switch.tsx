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
          'relative inline-flex h-[26px] w-[44px] shrink-0 rounded-full bg-fill-strong p-[2px]',
          'transition-colors duration-200 ease-out-soft data-checked:bg-sodium',
          'data-disabled:opacity-40',
        )}
      >
        <BaseSwitch.Thumb
          className={cn(
            'size-[22px] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.25)]',
            'transition-transform duration-200 ease-out-soft data-checked:translate-x-[18px]',
          )}
        />
      </BaseSwitch.Root>
      <span id={labelId} className={cn('text-body', hideLabel && 'sr-only')}>
        {label}
      </span>
    </span>
  );
}
