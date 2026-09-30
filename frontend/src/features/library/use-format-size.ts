'use client';

import { useFormatter } from 'next-intl';
import { sizeParts } from './format';

type Formatter = ReturnType<typeof useFormatter>;

export function formatSize(format: Formatter, bytes: number): string {
  const { value, unit, digits } = sizeParts(bytes);
  return format.number(value, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: digits });
}

export function useFormatSize(): (bytes: number) => string {
  const format = useFormatter();
  return (bytes) => formatSize(format, bytes);
}
