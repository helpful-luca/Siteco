'use client';

import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import type { ReactNode } from 'react';
import { cn } from './cn';

export type Choice<T extends string> = {
  value: T;
  title: string;
  /** A large picture filling the card's top (a theme thumbnail). */
  visual?: ReactNode;
  /** A small mark above the title (a flag). */
  icon?: ReactNode;
  hint?: string;
};

type Props<T extends string> = {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onValueChange: (value: T) => void;
};

/**
 * Large selectable choices with radio semantics (arrow keys move the choice). With a picture (a
 * theme thumbnail) they look like macOS appearance pickers: the picture carries the selection
 * ring with a small gap, the name sits below it. Without one, a filled card with a mark and title.
 */
export function ChoiceCards<T extends string>({ label, choices, value, onValueChange }: Props<T>) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      className="grid w-full gap-3"
      style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}
    >
      {choices.map((choice) =>
        choice.visual ? (
          <Radio.Root
            key={choice.value}
            value={choice.value}
            className="group flex min-w-0 flex-col items-center gap-2 rounded-control text-center outline-offset-4"
          >
            {/* Ring 2 px inside a 4 px inset: the gap between ring and picture, radius 12 > 8. */}
            <span
              className={cn(
                'block w-full rounded-control p-1 ring-inset transition-[box-shadow] duration-200 ease-out-soft',
                'ring-1 ring-transparent group-hover:ring-hairline-strong group-data-checked:ring-2 group-data-checked:ring-accent',
              )}
            >
              {choice.visual}
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-body text-ink-muted transition-colors group-data-checked:font-medium group-data-checked:text-ink">
                {choice.title}
              </span>
              {choice.hint && <span className="text-caption text-ink-muted">{choice.hint}</span>}
            </span>
          </Radio.Root>
        ) : (
          <Radio.Root
            key={choice.value}
            value={choice.value}
            className={cn(
              'group flex flex-col items-center gap-3 rounded-card px-4 py-5 text-center',
              'bg-fill ring-1 ring-inset ring-hairline transition-[background-color,box-shadow] duration-200 ease-out-soft',
              'hover:bg-fill-strong data-checked:bg-surface data-checked:ring-2 data-checked:ring-accent',
              'dark:data-checked:bg-surface-raised',
            )}
          >
            {choice.icon}
            <span className="flex flex-col gap-1">
              <span className="text-body font-medium">{choice.title}</span>
              {choice.hint && <span className="text-caption text-ink-muted">{choice.hint}</span>}
            </span>
          </Radio.Root>
        ),
      )}
    </RadioGroup>
  );
}
