/** File sizes in decimal units like Finder (1 MB = 1,000,000 bytes). */
export type SizeUnit = 'byte' | 'kilobyte' | 'megabyte' | 'gigabyte';

export function sizeParts(bytes: number): { value: number; unit: SizeUnit; digits: number } {
  if (bytes < 1_000) return { value: bytes, unit: 'byte', digits: 0 };
  if (bytes < 1_000_000) return { value: bytes / 1_000, unit: 'kilobyte', digits: 0 };
  if (bytes < 1_000_000_000) return { value: bytes / 1_000_000, unit: 'megabyte', digits: 1 };
  return { value: bytes / 1_000_000_000, unit: 'gigabyte', digits: 2 };
}
