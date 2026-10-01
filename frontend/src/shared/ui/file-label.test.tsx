import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FileLabel, splitExtension } from './file-label';

describe('splitExtension', () => {
  it('keeps a short extension apart from the stem', () => {
    expect(splitExtension('EN_13201_Beleuchtungsklassen.txt')).toEqual(['EN_13201_Beleuchtungsklassen', '.txt']);
    expect(splitExtension('Katalog.v2.pdf')).toEqual(['Katalog.v2', '.pdf']);
  });

  it('has no extension for dot files, names without a dot or long tails', () => {
    expect(splitExtension('.env')).toEqual(['.env', '']);
    expect(splitExtension('README')).toEqual(['README', '']);
    expect(splitExtension('Norm 13201.Teil-zwei-lang')).toEqual(['Norm 13201.Teil-zwei-lang', '']);
  });
});

describe('FileLabel', () => {
  it('truncates the stem only, so the extension stays visible, and keeps the full name as title', () => {
    const { container } = render(<FileLabel name="Wartung_LED_Module.md" />);
    const root = container.firstElementChild!;
    expect(root).toHaveAttribute('title', 'Wartung_LED_Module.md');
    expect(root).toHaveTextContent('Wartung_LED_Module.md');
    expect(root.firstElementChild).toHaveClass('truncate');
    expect(root.lastElementChild).toHaveClass('shrink-0');
  });
});
