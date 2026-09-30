import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { UIProvider } from '@/features/shell';
import { TooltipProvider } from '@/shared/ui';
import de from '../../../messages/de.json';
import { ArtifactView } from './artifact-view';

const download = vi.hoisted(() => vi.fn());
vi.mock('@/shared/lib/download', () => ({ downloadText: download }));

describe('ArtifactView', () => {
  it('saves a table as CSV and as Markdown without citation markers', async () => {
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <UIProvider>
          <TooltipProvider>
            <ArtifactView
              artifact={{
                kind: 'table',
                markdown: '| a | b |\n| - | - |\n| IP66⟦c:1⟧ | 2,5 |',
                citations: [],
                sources: [],
                messageKey: 'a1',
                chatTitle: 'Mira: Vergleich',
              }}
            />
          </TooltipProvider>
        </UIProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Als CSV speichern' }));
    expect(download).toHaveBeenCalledWith('Mira Vergleich.csv', '﻿a;b\r\nIP66;2,5\r\n', 'text/csv;charset=utf-8');
    await userEvent.click(screen.getByRole('button', { name: 'Als Markdown speichern' }));
    expect(download).toHaveBeenLastCalledWith('Mira Vergleich.md', '| a | b |\n| - | - |\n| IP66 | 2,5 |', 'text/markdown;charset=utf-8');
  });
});
