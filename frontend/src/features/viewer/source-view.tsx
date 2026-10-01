'use client';

import { Info } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { ApiError } from '@/shared/api/errors';
import type { ChunkOut, SourceOut } from '@/shared/api/types';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { DeletedSource } from './deleted-source';
import { highlightFor } from './highlight';
import { PdfViewer } from './pdf-viewer-client';
import type { PageStore } from './page-store';
import { fileUrl, useChunk } from './queries';
import { TextViewer, type TextSpan } from './text-viewer';

type Props = {
  source: SourceOut;
  /** Cited sentence indexes of the chunk; empty: the whole chunk is the passage. */
  sentences: number[];
  store: PageStore;
};

/** Character span of the cited sentences (text files), in the document's code points. */
export function spanFor(chunk: ChunkOut, sentences: number[]): TextSpan | null {
  const wanted = new Set(sentences);
  const selected = wanted.size ? chunk.sentences.filter((s) => wanted.has(s.i)) : chunk.sentences;
  if (selected.length === 0) return null;
  return {
    start: Math.min(...selected.map((s) => s.char_start)),
    end: Math.max(...selected.map((s) => s.char_end)),
  };
}

/**
 * A cited source in the right panel: the PDF on the cited page with the sentence marked, the text
 * file with the span marked, or the stored snapshot when the document is gone.
 */
export function SourceView({ source, sentences, store }: Props) {
  const [gone, setGone] = useState(source.deleted);
  const onMissing = useCallback(() => setGone(true), []);
  const chunk = useChunk(source.document_id, source.id, !gone);
  const chunkMissing = chunk.error instanceof ApiError && chunk.error.status === 404;

  if (gone || chunkMissing) return <DeletedSource />;
  if (source.page === null) {
    return (
      <TextViewer
        documentId={source.document_id}
        span={chunk.data ? spanFor(chunk.data, sentences) : null}
        onMissing={onMissing}
      />
    );
  }
  return (
    <PdfSource
      source={source}
      page={source.page}
      chunk={chunk.data ?? null}
      sentences={sentences}
      store={store}
      onMissing={onMissing}
    />
  );
}

type PdfSourceProps = {
  source: SourceOut;
  page: number;
  chunk: ChunkOut | null;
  sentences: number[];
  store: PageStore;
  onMissing: () => void;
};

function PdfSource({ source, page, chunk, sentences, store, onMissing }: PdfSourceProps) {
  const text = useCodeText();
  const highlight = useMemo(() => (chunk ? highlightFor(chunk, sentences) : null), [chunk, sentences]);
  const marks = useMemo(() => highlight?.rects ?? [], [highlight]);
  const fallback = highlight !== null && !highlight.exact;
  return (
    <div className="flex h-full flex-col">
      {fallback && (
        <p role="note" className="flex shrink-0 gap-2 border-b border-hairline px-6 py-3 text-footnote text-ink-muted">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>{text.notice('HIGHLIGHT_UNAVAILABLE', { page })}</span>
        </p>
      )}
      <div className="min-h-0 flex-1">
        <PdfViewer
          key={`${source.document_id}:${source.id}`}
          url={fileUrl(source.document_id)}
          store={store}
          page={page}
          marks={marks}
          passage={fallback && chunk ? chunk.text : null}
          onMissing={onMissing}
        />
      </div>
    </div>
  );
}
