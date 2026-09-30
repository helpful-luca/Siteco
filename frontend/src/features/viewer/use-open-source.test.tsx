import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RightPanel, UIProvider } from '@/features/shell';
import type { ChunkOut, SourceOut } from '@/shared/api/types';
import de from '../../../messages/de.json';
import type { PdfViewerProps } from './pdf-viewer';
import { useOpenSource } from './use-open-source';

const viewer = vi.hoisted(() => ({ props: null as PdfViewerProps | null }));
vi.mock('./pdf-viewer-client', async () => {
  const { useEffect } = await import('react');
  return {
    PdfViewer: (props: PdfViewerProps) => {
      viewer.props = props;
      // The file of A was deleted after the answer: the viewer reports it missing.
      useEffect(() => {
        if (props.url.includes('gone-doc')) props.onMissing?.();
      }, [props]);
      return <div data-testid="pdf-viewer" />;
    },
  };
});

const source = (id: string, documentId: string, page: number): SourceOut => ({
  id,
  index: 1,
  document_id: documentId,
  filename: `${documentId}.pdf`,
  page,
  snippet: 'Ausschnitt.',
  deleted: false,
});
const A = source('ca', 'gone-doc', 2);
const B = source('cb', 'live-doc', 7);
const CHUNK_B: ChunkOut = {
  chunk_id: 'cb',
  page: 7,
  precise_highlight: true,
  text: 'Satz.',
  sentences: [{ i: 0, text: 'Satz.', char_start: 0, char_end: 5, rects: [[0.1, 0.5, 0.2, 0.02]] }],
};

function Buttons() {
  const open = useOpenSource();
  return (
    <>
      <button type="button" onClick={() => open({ messageKey: 'm1', source: A, citedText: null })}>
        A
      </button>
      <button type="button" onClick={() => open({ messageKey: 'm1', source: B, citedText: null })}>
        B
      </button>
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1280px)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json({ ...CHUNK_B, chunk_id: url.split('/').pop() }),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('useOpenSource', () => {
  it('starts every source with fresh viewer state', async () => {
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="de" messages={de}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <UIProvider>
            <Buttons />
            <RightPanel />
          </UIProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'A' }));
    expect(await screen.findByRole('heading', { name: 'Quelle wurde gelöscht' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'gone-doc.pdf' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'B' }));
    await waitFor(() => expect(viewer.props?.marks).toEqual([[0.1, 0.5, 0.2, 0.02]]));
    expect(viewer.props).toMatchObject({ url: '/api/documents/live-doc/file', page: 7 });
    expect(screen.queryByRole('heading', { name: 'Quelle wurde gelöscht' })).toBeNull();
    expect(screen.getByRole('complementary', { name: 'live-doc.pdf' })).toHaveTextContent('Seite 7');
  });
});
