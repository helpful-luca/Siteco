import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
  it('truncates the stem only, so the extension stays visible', () => {
    const { container } = render(<FileLabel name="Wartung_LED_Module.md" />);
    const root = container.firstElementChild!;
    expect(root).toHaveTextContent('Wartung_LED_Module.md');
    expect(root.firstElementChild).toHaveClass('truncate');
    expect(root.lastElementChild).toHaveClass('shrink-0');
  });

  it('shows the full name on hover only when it is cut', async () => {
    const name = 'SIT_KAT_Beleuchtungsloesungen_DE_2026.pdf';
    const { container } = render(<FileLabel name={name} />);
    const stem = container.querySelector<HTMLElement>('.truncate')!;
    const user = userEvent.setup();

    await user.hover(container.firstElementChild!);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByText(name)).toBeNull();

    await user.unhover(container.firstElementChild!);
    vi.spyOn(stem, 'scrollWidth', 'get').mockReturnValue(400);
    vi.spyOn(stem, 'clientWidth', 'get').mockReturnValue(200);
    await user.hover(container.firstElementChild!);
    expect(await screen.findByText(name)).toBeInTheDocument();
  });
});
