'use client';

import { FileWarning } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { Document, Page, pdfjs, useDocumentContext, type DocumentProps } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import { Button, cn, DelayedSpinner, ErrorBoundary } from '@/shared/ui';
import { markStyle, type Rect } from './highlight';
import { nextZoom, pageAt, pageLayout, ratiosFor, scrollTopFor, visibleRange } from './page-layout';
import type { PageStore } from './page-store';
import { escapeHtml, matchTextItems } from './text-layer-match';
import { ViewerToolbar } from './viewer-toolbar';

// The worker is set in this module, next to <Document> (annex 12, 1f): set elsewhere, react-pdf's
// default would overwrite it. Turbopack emits it as a same-origin file (CSP `worker-src 'self'`).
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

const OPTIONS: DocumentProps['options'] = {
  // Only the byte ranges of the pages in view: a 400 MB catalog opens at once on the cited page.
  // Small chunks (pdf.js's 64 KB default): PDF.js reads every page dictionary of a flat page tree,
  // and each read costs one chunk.
  disableAutoFetch: true,
  disableStream: true,
  rangeChunkSize: 64 * 1024,
  cMapUrl: '/pdfjs/cmaps/',
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  wasmUrl: '/pdfjs/wasm/',
  enableXfa: false,
  // pdf.js 6 has no eval path any more; the flag stays so it can never come back (master spec 6.9).
  ...{ isEvalSupported: false },
};

const A4 = 297 / 210;
const SPACING = { gap: 16, padding: 16 };
const SIDE = 16;
// Pages mount a little before they scroll into view, and unmount when far away (memory).
const OVERSCAN = 800;
// A highlight scrolled into view sits a bit above the middle, where the eye rests.
const FOCUS = 0.3;
const MARK_STAGGER_MS = 60;

export type PdfViewerProps = {
  url: string;
  store: PageStore;
  /** 1-based page to open on. */
  page: number;
  /** Line rectangles to mark on `page`. */
  marks: Rect[];
  /** Fallback: a passage to find and mark in the text layer of `page`, when there is no geometry. */
  passage: string | null;
  /** The file is gone (404, 410): the document was deleted meanwhile. */
  onMissing?: () => void;
};

function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

/** PDF viewer for the right panel: virtualized pages, range requests, sentence marks. */
export default function PdfViewer(props: PdfViewerProps) {
  return (
    <ErrorBoundary fallback={(error, reset) => <ViewerError error={error} onRetry={reset} onMissing={props.onMissing} />}>
      <Suspense fallback={<ViewerLoading />}>
        <Document file={props.url} options={OPTIONS} className="h-full" loading={null}>
          <PageColumn {...props} />
        </Document>
      </Suspense>
    </ErrorBoundary>
  );
}

function ViewerLoading() {
  const t = useTranslations('viewer.pdf');
  return (
    <div className="grid h-full place-items-center bg-fill">
      <DelayedSpinner label={t('loading')} className="size-5" />
    </div>
  );
}

function ViewerError({ error, onRetry, onMissing }: { error: unknown; onRetry: () => void; onMissing?: () => void }) {
  const t = useTranslations('viewer.pdf');
  const missing = [404, 410].includes(statusOf(error) ?? 0);
  useEffect(() => {
    if (missing) onMissing?.();
  }, [missing, onMissing]);
  if (missing && onMissing) return null;
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center bg-fill px-6 text-center">
      <FileWarning aria-hidden className="size-7 text-ink-muted" />
      <p className="mt-4 text-body font-medium">{t('errorTitle')}</p>
      <p className="mt-1 max-w-[36ch] text-footnote text-ink-muted">{t('errorText')}</p>
      <Button size="sm" className="mt-6" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}

type Viewport = { width: number; height: number };

function useViewport(element: RefObject<HTMLElement | null>): Viewport {
  const [size, setSize] = useState<Viewport>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = element.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setSize({ width: node.clientWidth, height: node.clientHeight }));
    observer.observe(node);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

type Anchor = { index: number; fraction: number };

function PageColumn({ store, page, marks, passage }: PdfViewerProps) {
  const t = useTranslations('viewer.pdf');
  const pdf = useDocumentContext()?.pdf || null;
  const pages = pdf?.numPages ?? 0;
  const target = Math.min(Math.max(1, page), Math.max(1, pages)) - 1;
  const scroller = useRef<HTMLDivElement>(null);
  const viewport = useViewport(scroller);
  const [measured, setMeasured] = useState<ReadonlyMap<number, number>>(new Map());
  const [estimate, setEstimate] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [scrollTop, setScrollTop] = useState(0);
  // Until the first scroll event the column is where the opening jump puts it, so page 1 of a
  // catalog is never loaded just because the first frame started at the top.
  const [scrolled, setScrolled] = useState(false);
  // Pages painted at the current width; a zoom repaints them, and marks wait for the new paint.
  const [rendered, setRendered] = useState<{ width: number; pages: ReadonlySet<number> }>({ width: 0, pages: new Set() });
  const anchor = useRef<Anchor | null>(null);
  const jumped = useRef(false);

  // The cited page's shape is the estimate for every page not measured yet: a catalog is usually
  // uniform, so the column is right before any other page loads.
  useEffect(() => {
    if (!pdf) return;
    let alive = true;
    pdf.getPage(target + 1).then(
      (proxy) => {
        const { width, height } = proxy.getViewport({ scale: 1 });
        if (!alive) return;
        setMeasured((current) => new Map(current).set(target, height / width));
        setEstimate(height / width);
      },
      () => alive && setEstimate(A4),
    );
    return () => {
      alive = false;
    };
  }, [pdf, target]);

  const fitWidth = Math.max(0, viewport.width - 2 * SIDE);
  const width = Math.round(fitWidth * zoom);
  const layout = useMemo(
    () => pageLayout(ratiosFor(pages, measured, estimate ?? A4), width, SPACING),
    [pages, measured, estimate, width],
  );
  const ready = estimate !== null && width > 0 && viewport.height > 0;

  const remember = useCallback(
    (top: number) => {
      const index = pageAt(layout, top);
      anchor.current = { index, fraction: (top - layout.tops[index]) / Math.max(1, layout.heights[index]) };
      setScrollTop(top);
      setScrolled(true);
    },
    [layout],
  );

  // Only the element moves; its scroll event then updates the state (see onScroll).
  const scrollTo = useCallback((top: number) => {
    if (scroller.current) scroller.current.scrollTop = top;
  }, []);

  const firstMark = marks[0] ?? null;
  const openingTop = scrollTopFor(layout, target, firstMark ? firstMark[1] : 0, viewport.height, firstMark ? FOCUS : 0);
  const top = scrolled ? scrollTop : openingTop;

  // Opening: straight to the cited page, the first mark a bit above the middle.
  useLayoutEffect(() => {
    if (!ready || jumped.current) return;
    jumped.current = true;
    scrollTo(openingTop);
  }, [ready, openingTop, scrollTo]);

  // Marks that arrive after the page is open are scrolled into view unless already visible.
  useEffect(() => {
    const node = scroller.current;
    if (!ready || !firstMark || !node) return;
    const y = layout.tops[target] + firstMark[1] * layout.heights[target];
    if (y < node.scrollTop || y > node.scrollTop + viewport.height * 0.8) {
      scrollTo(scrollTopFor(layout, target, firstMark[1], viewport.height, FOCUS));
    }
    // Only when the marks change, not on every layout change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstMark]);

  // Keep the page under the reading position still when sizes change (zoom, width, measured pages).
  useLayoutEffect(() => {
    const current = anchor.current;
    const node = scroller.current;
    if (!ready || !current || !node) return;
    const top = Math.round(layout.tops[current.index] + current.fraction * layout.heights[current.index]);
    if (Math.abs(top - node.scrollTop) > 1) scrollTo(top);
  }, [layout, ready, scrollTo]);

  // At the end of the column the last page is the current one, even if it is short.
  const atEnd = top >= layout.total - viewport.height - 1;
  const current = !ready ? target : atEnd ? pages - 1 : pageAt(layout, top + viewport.height * 0.4);
  useEffect(() => {
    if (pages) store.set({ page: current + 1, pages });
  }, [store, current, pages]);

  const onScroll = () => {
    if (scroller.current) remember(scroller.current.scrollTop);
  };

  // A page jump shows the page's top edge with a little of the gap above it.
  const goTo = (index: number) => {
    const clamped = Math.min(Math.max(0, index), pages - 1);
    scrollTo(Math.max(0, scrollTopFor(layout, clamped, 0, viewport.height) - SPACING.gap / 2));
  };

  const measure = useCallback((index: number, ratio: number) => {
    setMeasured((known) => (Math.abs((known.get(index) ?? 0) - ratio) < 0.001 ? known : new Map(known).set(index, ratio)));
  }, []);
  const markRendered = useCallback(
    (index: number) => {
      setRendered((done) => {
        if (done.width !== width) return { width, pages: new Set([index]) };
        return done.pages.has(index) ? done : { width, pages: new Set(done.pages).add(index) };
      });
    },
    [width],
  );
  const paintedPages = rendered.width === width ? rendered.pages : null;

  const [first, last] = ready ? visibleRange(layout, top, viewport.height, OVERSCAN) : [0, -1];
  const indexes = [];
  for (let index = first; index <= last; index += 1) indexes.push(index);
  const contentWidth = Math.max(viewport.width, width + 2 * SIDE);
  const left = Math.round((contentWidth - width) / 2);

  return (
    <div className="relative h-full">
      <div
        ref={scroller}
        onScroll={onScroll}
        tabIndex={0}
        aria-label={t('pages')}
        className="no-scrollbar h-full overflow-auto overscroll-contain bg-fill outline-none"
      >
        <div className="relative" style={{ height: layout.total, width: contentWidth }}>
          {indexes.map((index) => (
            <PageSlot
              key={index}
              index={index}
              label={t('page', { page: index + 1 })}
              style={{ top: layout.tops[index], left, width, height: layout.heights[index] }}
              width={width}
              marks={index === target ? marks : []}
              passage={index === target ? passage : null}
              rendered={paintedPages?.has(index) ?? false}
              onMeasure={measure}
              onRendered={markRendered}
            />
          ))}
        </div>
      </div>
      {pages > 0 && (
        <ViewerToolbar
          page={current + 1}
          pages={pages}
          zoom={zoom}
          onPage={(number) => goTo(number - 1)}
          onZoom={(direction) => setZoom((value) => nextZoom(value, direction))}
          onFit={() => setZoom(1)}
        />
      )}
    </div>
  );
}

type SlotProps = {
  index: number;
  label: string;
  style: CSSProperties;
  width: number;
  marks: Rect[];
  passage: string | null;
  rendered: boolean;
  onMeasure: (index: number, ratio: number) => void;
  onRendered: (index: number) => void;
};

function PageSlot({ index, label, style, width, marks, passage, rendered, onMeasure, onRendered }: SlotProps) {
  // Text items of the page; the match follows the passage, which can change on the same page.
  const [items, setItems] = useState<string[] | null>(null);
  const matched = useMemo(() => (items && passage ? matchTextItems(items, passage) : null), [items, passage]);
  const renderText = useMemo(
    () =>
      passage
        ? ({ str, itemIndex }: { str: string; itemIndex: number }) =>
            matched?.has(itemIndex) ? `<mark>${escapeHtml(str)}</mark>` : escapeHtml(str)
        : undefined,
    [passage, matched],
  );
  // No geometry and the passage is not in PDF.js's text either: frame the whole page.
  const wholePage = passage !== null && matched !== null && matched.size === 0;

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'pdf-page absolute overflow-hidden bg-white shadow-[0_1px_3px_rgb(0_0_0/0.12)] ring-1 ring-hairline',
        wholePage && rendered && 'ring-2 ring-accent',
      )}
      style={style}
    >
      <Suspense fallback={null}>
        <Page
          pageNumber={index + 1}
          width={width}
          renderAnnotationLayer={false}
          renderTextLayer
          loading={null}
          customTextRenderer={renderText}
          onLoadSuccess={(page) => {
            const { width: w, height: h } = page.getViewport({ scale: 1 });
            onMeasure(index, h / w);
          }}
          onRenderSuccess={() => onRendered(index)}
          onGetTextSuccess={
            passage ? (content) => setItems(content.items.map((item) => ('str' in item ? item.str : ''))) : undefined
          }
        />
      </Suspense>
      {rendered &&
        marks.map((rect, n) => (
          <div
            key={`${rect.join(',')}-${n}`}
            aria-hidden
            data-testid="pdf-mark"
            className="lamp-on-mark pointer-events-none absolute"
            style={{ ...markStyle(rect), ['--mark-delay' as string]: `${n * MARK_STAGGER_MS}ms` }}
          />
        ))}
    </div>
  );
}
