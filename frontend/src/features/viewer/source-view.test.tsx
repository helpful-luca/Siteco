import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChunkOut, SourceOut } from '@/shared/api/types';
import de from '../../../messages/de.json';
import { createPageStore } from './page-store';
import type { PdfViewerProps } from './pdf-viewer';
import { SourceView, spanFor } from './source-view';
import { textPieces } from './text-viewer';

const viewer = vi.hoisted(() => ({ props: null as PdfViewerProps | null }));
vi.mock('./pdf-viewer-client', () => ({
  PdfViewer: (props: PdfViewerProps) => {
    viewer.props = props;
    return <div data-testid="pdf-viewer" />;
  },
}));

const SOURCE: SourceOut = {
  id: 'c1',
  index: 1,
  document_id: 'd1',
  filename: 'Mira_L_Datenblatt.pdf',
  page: 4,
  snippet: 'Die Mira L ist nach IP66 geschützt. Die Schlagfestigkeit liegt bei IK09.',
  deleted: false,
};

const CHUNK: ChunkOut = {
  chunk_id: 'c1',
  page: 4,
  precise_highlight: true,
  text: 'Die Mira L ist nach IP66 geschützt. Die Schlagfestigkeit liegt bei IK09.',
  sentences: [
    { i: 0, text: 'Die Mira L ist nach IP66 geschützt.', char_start: 0, char_end: 35, rects: [[0.1, 0.2, 0.6, 0.02]] },
    { i: 1, text: 'Die Schlagfestigkeit liegt bei IK09.', char_start: 36, char_end: 72, rects: [[0.1, 0.23, 0.5, 0.02]] },
  ],
};

function envelope(status: number, code: string) {
  return Response.json({ error: { code, retryable: false } }, { status });
}

function setup(source: SourceOut, responses: Record<string, () => Response>, sentences: number[] = [1]) {
  viewer.props = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (responses[url] ?? (() => envelope(404, 'NOT_FOUND')))()),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <QueryClientProvider client={client}>
        <div style={{ height: 800 }}>
          <SourceView
            source={source}
            citedText="Die Schlagfestigkeit liegt bei IK09."
            sentences={sentences}
            store={createPageStore({ page: 4, pages: null })}
          />
        </div>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('SourceView', () => {
  it('opens the PDF on the cited page with the rectangles of the cited sentence', async () => {
    setup(SOURCE, { '/api/documents/d1/chunks/c1': () => Response.json(CHUNK) });
    await waitFor(() => expect(viewer.props?.marks).toEqual([[0.1, 0.23, 0.5, 0.02]]));
    expect(viewer.props).toMatchObject({ url: '/api/documents/d1/file', page: 4, passage: null });
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('takes the fallback path with a calm notice when the page has no precise geometry', async () => {
    const imprecise = { ...CHUNK, precise_highlight: false, sentences: CHUNK.sentences.map((s) => ({ ...s, rects: [] })) };
    setup(SOURCE, { '/api/documents/d1/chunks/c1': () => Response.json(imprecise) });
    expect(await screen.findByRole('note')).toHaveTextContent(
      'Die genaue Stelle können wir hier nicht markieren. Du findest sie auf Seite 4.',
    );
    expect(viewer.props).toMatchObject({ marks: [], passage: CHUNK.text });
  });

  it('shows the stored snapshot for a deleted source', async () => {
    setup({ ...SOURCE, deleted: true }, {});
    expect(screen.getByRole('heading', { name: 'Quelle wurde gelöscht' })).toBeInTheDocument();
    expect(screen.getByText('Die Schlagfestigkeit liegt bei IK09.')).toHaveClass('text-mark');
    expect(screen.getByText(SOURCE.snippet)).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-viewer')).toBeNull();
  });

  it('treats a source whose document disappeared meanwhile as deleted', async () => {
    setup(SOURCE, { '/api/documents/d1/chunks/c1': () => envelope(404, 'NOT_FOUND') });
    expect(await screen.findByRole('heading', { name: 'Quelle wurde gelöscht' })).toBeInTheDocument();
  });

  it('shows a text file as source text with the cited span marked', async () => {
    const text = '# Wartung 😀\n\nDie Module werden geprüft. **Nicht** als Markdown.\n';
    const chunk: ChunkOut = {
      chunk_id: 'c2',
      page: null,
      precise_highlight: true,
      text: 'Die Module werden geprüft.',
      sentences: [{ i: 0, text: 'Die Module werden geprüft.', char_start: 13, char_end: 39, rects: [] }],
    };
    setup({ ...SOURCE, id: 'c2', page: null, filename: 'Wartung.md' }, {
      '/api/documents/d1/chunks/c2': () => Response.json(chunk),
      '/api/documents/d1/text': () => new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } }),
    }, []);
    const mark = await screen.findByText('Die Module werden geprüft.', { selector: 'mark' });
    expect(mark).toHaveClass('text-mark');
    expect(screen.getByText(/\*\*Nicht\*\* als Markdown/)).toBeInTheDocument();
    expect(document.querySelector('strong, h1')).toBeNull();
  });
});

describe('spanFor and textPieces', () => {
  it('spans the cited sentences and maps code points to string indexes', () => {
    expect(spanFor(CHUNK, [1])).toEqual({ start: 36, end: 72 });
    expect(spanFor(CHUNK, [])).toEqual({ start: 0, end: 72 });
    const [pieces] = textPieces('😀 Satz eins. Satz zwei.', { start: 2, end: 12 });
    expect(pieces).toEqual([
      { text: '😀 ', marked: false },
      { text: 'Satz eins.', marked: true },
      { text: ' Satz zwei.', marked: false },
    ]);
  });

  it('cuts long texts into blocks and keeps the mark across a block edge', () => {
    const text = 'a'.repeat(19_990) + 'Markierter Satz.' + 'b'.repeat(100);
    const blocks = textPieces(text, { start: 19_990, end: 20_006 });
    expect(blocks).toHaveLength(2);
    const marked = blocks.flat().filter((p) => p.marked).map((p) => p.text).join('');
    expect(marked).toBe('Markierter Satz.');
  });
});
