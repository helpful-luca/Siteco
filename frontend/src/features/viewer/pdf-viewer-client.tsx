'use client';

import dynamic from 'next/dynamic';

/**
 * react-pdf needs `window`, so the viewer is a client-only chunk: `ssr: false` is
 * only allowed inside a client component, hence this wrapper. It also keeps PDF.js out of every
 * page bundle until a PDF is opened.
 */
export const PdfViewer = dynamic(() => import('./pdf-viewer'), { ssr: false, loading: () => null });
export type { PdfViewerProps } from './pdf-viewer';
