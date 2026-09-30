import { createFormatter } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { sizeParts } from './format';
import { formatSize } from './use-format-size';

describe('sizeParts', () => {
  it('picks a decimal unit like Finder', () => {
    expect(sizeParts(512)).toEqual({ value: 512, unit: 'byte', digits: 0 });
    expect(sizeParts(850_000)).toMatchObject({ unit: 'kilobyte', value: 850 });
    expect(sizeParts(1_234_567)).toMatchObject({ unit: 'megabyte', digits: 1 });
    expect(sizeParts(2_500_000_000)).toMatchObject({ unit: 'gigabyte', value: 2.5 });
  });

  it('formats in the UI language', () => {
    const de = createFormatter({ locale: 'de' });
    const en = createFormatter({ locale: 'en' });
    expect(formatSize(de, 1_234_567)).toBe('1,2 MB');
    expect(formatSize(en, 1_234_567)).toBe('1.2 MB');
    expect(formatSize(de, 850_000)).toBe('850 kB');
  });
});
