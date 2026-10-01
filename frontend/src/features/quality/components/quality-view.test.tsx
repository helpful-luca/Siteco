import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UIProvider } from '@/features/shell';
import type { EvalOut } from '@/shared/api/types';
import { TooltipProvider } from '@/shared/ui';
import de from '../../../../messages/de.json';
import latest from '../../../../../eval/results/latest.json';
import { formatShare } from '../format';
import { QualityView } from './quality-view';

/** Only /api/eval answers; everything else the page asks for never resolves. */
function setup(response: () => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url === '/api/eval' ? response() : new Promise<Response>(() => undefined))),
  );
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Berlin">
      <QueryClientProvider client={new QueryClient()}>
        <UIProvider>
          <TooltipProvider>
            <QualityView />
          </TooltipProvider>
        </UIProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const results = { ...(latest as unknown as EvalOut), stale: false, generation: null };

afterEach(() => vi.unstubAllGlobals());

describe('QualityView', () => {
  it('shows what the runner measured: default first, every configuration, date and commit', async () => {
    setup(() => Response.json(results));
    expect(await screen.findByRole('heading', { name: 'Qualität' })).toBeInTheDocument();
    const [standard] = results.configs.filter((c) => c.default);
    const summary = screen.getByRole('region', { name: 'Standard: Hybrid-Suche' });
    expect(summary.textContent?.replace(/\s/g, ' ')).toContain(formatShare(standard.metrics.in_sources, 'de').replace(/\s/g, ' '));
    const table = screen.getByRole('table', { name: 'Jede Konfiguration mit ihren Messwerten' });
    expect(within(table).getAllByRole('row')).toHaveLength(results.configs.length + 1);
    expect(screen.getByText(new RegExp(`Commit ${results.commit}`))).toBeInTheDocument();
    expect(screen.queryByText('Veraltet')).toBeNull();
    expect(screen.getByText(/Noch nicht gemessen/)).toBeInTheDocument();
  });

  it('marks results of another configuration as out of date', async () => {
    setup(() => Response.json({ ...results, stale: true }));
    expect(await screen.findByText('Veraltet')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(de.quality.stale.text);
  });

  it('explains how to create results when there are none', async () => {
    setup(() => Response.json({ error: { code: 'EVAL_RESULTS_MISSING', retryable: false, request_id: 'r', params: {} } }, { status: 404 }));
    expect(await screen.findByRole('heading', { name: de.quality.empty.title })).toBeInTheDocument();
    expect(screen.getByText('make eval')).toBeInTheDocument();
  });
});
