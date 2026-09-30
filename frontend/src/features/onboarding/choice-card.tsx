'use client';

import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import type { ReactNode } from 'react';
import { cn } from '@/shared/ui';

export type Choice<T extends string> = { value: T; title: string; visual?: ReactNode; hint?: string };

type Props<T extends string> = {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onValueChange: (value: T) => void;
};

/** Large selectable cards with radio semantics (arrow keys move the choice). */
export function ChoiceCards<T extends string>({ label, choices, value, onValueChange }: Props<T>) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      className="grid w-full gap-3"
      style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}
    >
      {choices.map((choice) => (
        <Radio.Root
          key={choice.value}
          value={choice.value}
          className={cn(
            'group flex flex-col items-center gap-3 rounded-card p-3 pb-4 text-center',
            'bg-fill ring-1 ring-inset ring-hairline transition-[background-color,box-shadow] duration-200 ease-out-soft',
            'hover:bg-fill-strong data-checked:bg-surface data-checked:ring-2 data-checked:ring-sodium',
            'dark:data-checked:bg-surface-raised',
          )}
        >
          {choice.visual}
          <span className="text-body font-medium">{choice.title}</span>
          {choice.hint && <span className="-mt-2 text-caption text-ink-muted">{choice.hint}</span>}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
