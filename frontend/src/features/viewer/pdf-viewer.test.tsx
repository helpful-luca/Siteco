import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/shared/ui';
import de from '../../../messages/de.json';
import { createPageStore } from './page-store';
import PdfViewer, { type PdfViewerProps } from './pdf-viewer';

// react-pdf needs a canvas and a worker; the viewer's own logic is what is tested here.
const TEXT_ITEMS = ['Technische Daten', 'Die Mira L hat die Schutz-', 'art IP66.', 'Gewicht 7,4 kg'];
const viewport = { width: 100, height: 141 };

vi.mock('react-pdf/dist/Page/TextLayer.css', () => ({}));
vi.mock('react-pdf', () => {
  type PageMockProps = {
    pageNumber: number;
    width: number;
    onLoadSuccess?: (page: { getViewport: () => typeof viewport }) => void;
    onRenderSuccess?: () => void;
    onGetTextSuccess?: (content: { items: { str: string }[] }) => void;
    customTextRenderer?: (item: { str: string; itemIndex: number }) => string;
  };
  function Page({ pageNumber, width, onLoadSuccess, onRenderSuccess, onGetTextSuccess, customTextRenderer }: PageMockProps) {
    useEffect(() => {
      onLoadSuccess?.({ getViewport: () => viewport });
      onGetTextSuccess?.({ items: TEXT_ITEMS.map((str) => ({ str })) });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Like PDF.js, a new width paints the canvas again.
    useEffect(() => {
      onRenderSuccess?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [width]);
    const html = customTextRenderer ? TEXT_ITEMS.map((str, itemIndex) => customTextRenderer({ str, itemIndex })).join(' ') : '';
    return <div data-testid={`canvas-${pageNumber}`} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  const pdf = { numPages: 12, getPage: async () => ({ getViewport: () => viewport }) };
  function Document({ file, children }: { file: string; children: React.ReactNode }) {
    if (file.includes('corrupt')) throw Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' });
    if (file.includes('gone')) throw Object.assign(new Error('Missing PDF'), { status: 404 });
    return <div>{children}</div>;
  }
  return { Document, Page, pdfjs: { GlobalWorkerOptions: {} }, useDocumentContext: () => ({ pdf }) };
});

const WIDTH = 632; // 600 px pages plus 16 px on each side
const HEIGHT = 800;

beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(WIDTH);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(HEIGHT);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: (entries: unknown[], observer: unknown) => void) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: WIDTH, height: HEIGHT } }], this);
      }
      unobserve() {}
      disconnect() {}
    },
  );
});

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(props: Partial<PdfViewerProps> = {}) {
  const store = createPageStore({ page: props.page ?? 1, pages: null });
  const onMissing = vi.fn();
  const view = (next: Partial<PdfViewerProps>) => (
    <NextIntlClientProvider locale="de" messages={de}>
      <TooltipProvider>
        <div style={{ height: HEIGHT }}>
          <PdfViewer url="/api/documents/d1/file" store={store} page={1} marks={[]} passage={null} onMissing={onMissing} {...next} />
        </div>
      </TooltipProvider>
    </NextIntlClientProvider>
  );
  const { rerender } = render(view(props));
  const update = (next: Partial<PdfViewerProps>) => rerender(view({ ...props, ...next }));
  const scroller = () => screen.getByLabelText('Seiten des Dokuments');
  // jsdom does not fire scroll events for programmatic scrolling; the browser does.
  const settle = () => act(() => void fireEvent.scroll(scroller()));
  return { store, onMissing, scroller, settle, update };
}

describe('PdfViewer', () => {
  it('opens on the cited page and marks the sentence there', async () => {
    const { store, scroller, settle } = setup({ page: 4, marks: [[0.1, 0.2, 0.5, 0.02]] });
    await screen.findByLabelText('Seite 4');
    expect(screen.queryByLabelText('Seite 1')).toBeNull(); // page 1 of a catalog is never loaded
    settle();
    // Page height 600 * 1.41 = 846, 16 px gaps: page 4 starts at 16 + 3 * 862.
    const pageTop = 16 + 3 * 862;
    expect(scroller().scrollTop).toBe(Math.round(pageTop + 0.2 * 846 - 0.3 * HEIGHT));
    const slot = await screen.findByLabelText('Seite 4');
    const [mark] = within(slot).getAllByTestId('pdf-mark');
    expect(mark).toHaveClass('lamp-on-mark');
    expect(mark.style.left).toBe('9.8%');
    expect(mark.style.width).toBe('50.4%');
    expect(store.get()).toEqual({ page: 4, pages: 12 });
    expect(screen.queryAllByTestId('pdf-mark')).toHaveLength(1);
  });

  it('renders only the pages near the viewport of a long document', async () => {
    setup({ page: 10 });
    await screen.findByLabelText('Seite 10');
    const mounted = screen.getAllByRole('group').map((el) => el.getAttribute('aria-label'));
    expect(mounted.length).toBeLessThan(6);
    expect(mounted).not.toContain('Seite 1');
  });

  it('moves between pages with the toolbar and the page field', async () => {
    const user = userEvent.setup();
    const { store, scroller, settle } = setup({ page: 2 });
    await screen.findByLabelText('Seite 2');
    settle();
    expect(store.get().page).toBe(2);
    await user.click(screen.getByRole('button', { name: 'Nächste Seite' }));
    settle();
    expect(scroller().scrollTop).toBe(16 + 2 * 862 - 8);
    expect(store.get().page).toBe(3);
    const field = screen.getByLabelText('Seitenzahl');
    await user.click(field);
    await user.keyboard('{Control>}a{/Control}9{Enter}');
    settle();
    expect(store.get().page).toBe(9);
  });

  it('keeps the marks through a zoom, repainted at the new width', async () => {
    const user = userEvent.setup();
    setup({ page: 1, marks: [[0.1, 0.2, 0.5, 0.02]] });
    const slot = await screen.findByLabelText('Seite 1');
    // The marks follow the page a moment later (after the chunk loaded): wait, never race.
    expect(await within(slot).findAllByTestId('pdf-mark')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Vergrößern' }));
    await waitFor(() => expect(within(screen.getByLabelText('Seite 1')).getAllByTestId('pdf-mark')).toHaveLength(1));
  });

  it('zooms and fits the page back to the width', async () => {
    const user = userEvent.setup();
    setup({ page: 1 });
    const slot = await screen.findByLabelText('Seite 1');
    expect(slot.style.width).toBe('600px');
    await user.click(screen.getByRole('button', { name: 'Vergrößern' }));
    expect(screen.getByLabelText('Seite 1').style.width).toBe('750px');
    await user.click(screen.getByRole('button', { name: /An Breite anpassen/ }));
    expect(screen.getByLabelText('Seite 1').style.width).toBe('600px');
  });

  it('falls back to marking the passage in the text layer', async () => {
    setup({ page: 3, passage: 'Die Mira L hat die Schutzart IP66.' });
    const slot = await screen.findByLabelText('Seite 3');
    await waitFor(() => expect(within(slot).getAllByText(/Schutz-|IP66/, { selector: 'mark' })).toHaveLength(2));
    expect(slot).not.toHaveClass('ring-accent');
  });

  it('follows a new passage on the same page', async () => {
    const { update } = setup({ page: 3, passage: 'Technische Daten' });
    const slot = await screen.findByLabelText('Seite 3');
    await waitFor(() => expect(within(slot).getByText('Technische Daten', { selector: 'mark' })).toBeInTheDocument());
    update({ passage: 'Gewicht 7,4 kg' });
    await waitFor(() => expect(within(slot).getByText('Gewicht 7,4 kg', { selector: 'mark' })).toBeInTheDocument());
    expect(within(slot).queryByText('Technische Daten', { selector: 'mark' })).toBeNull();
  });

  it('names the last page when the column is scrolled to the end', async () => {
    const user = userEvent.setup();
    const { store, scroller, settle } = setup({ page: 12 });
    await screen.findByLabelText('Seite 12');
    // At 50 % a page is shorter than the reading line's distance from the bottom.
    await user.click(screen.getByRole('button', { name: 'Verkleinern' }));
    await user.click(screen.getByRole('button', { name: 'Verkleinern' }));
    const node = scroller();
    node.scrollTop = 16 + 12 * 423 + 11 * 16 + 16 - HEIGHT;
    settle();
    expect(store.get().page).toBe(12);
  });

  it('frames the whole page when the passage is not in the text layer either', async () => {
    setup({ page: 3, passage: 'Ein Satz, der auf dieser Seite nicht vorkommt.' });
    const slot = await screen.findByLabelText('Seite 3');
    await waitFor(() => expect(slot).toHaveClass('ring-accent'));
    expect(within(slot).queryByText(/IP66/, { selector: 'mark' })).toBeNull();
  });

  it('escapes document text in the text layer', async () => {
    TEXT_ITEMS.push('<img src=x onerror="alert(1)">');
    setup({ page: 1, passage: 'Die Mira L hat die Schutzart IP66.' });
    const slot = await screen.findByLabelText('Seite 1');
    await waitFor(() => expect(within(slot).getByTestId('canvas-1').innerHTML).toContain('&lt;img'));
    expect(slot.querySelector('img')).toBeNull();
    TEXT_ITEMS.pop();
  });

  it('shows a calm error with a retry for a corrupt PDF', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setup({ url: '/api/documents/corrupt/file' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Das Dokument lässt sich hier nicht anzeigen');
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
  });

  it('reports a file that is gone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { onMissing } = setup({ url: '/api/documents/gone/file' });
    await waitFor(() => expect(onMissing).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
