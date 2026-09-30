import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/shared/ui';
import de from '../../../messages/de.json';
import { CitationChip } from './citation-chip';

const SOURCE = {
  id: 'c1',
  index: 1,
  document_id: 'd1',
  filename: 'Mira.pdf',
  page: 4,
  snippet: 'IP66.',
  deleted: true,
};

describe('CitationChip', () => {
  it('opens the stored snapshot of a deleted source', async () => {
    const onOpen = vi.fn();
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <TooltipProvider>
          <CitationChip n={1} source={SOURCE} citedText="IP66." onOpen={onOpen} />
        </TooltipProvider>
      </NextIntlClientProvider>,
    );
    const chip = screen.getByRole('button', { name: 'Quelle 1: Mira.pdf, Seite 4, Quelle gelöscht' });
    expect(chip).not.toHaveAttribute('aria-disabled');
    await userEvent.click(chip);
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
