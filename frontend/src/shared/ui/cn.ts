import { clsx, type ClassValue } from 'clsx';

/** Joins class names; later classes do not override earlier ones, so keep variants disjoint. */
export function cn(...values: ClassValue[]): string {
  return clsx(values);
}
