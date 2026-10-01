'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef } from 'react';
import { ApiError } from '@/shared/api/errors';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { utf16Index } from '@/shared/lib/code-points';
import { DelayedSpinner } from '@/shared/ui';
import { useDocumentText } from './queries';

/** [start, end) in code points of the normalized document text, as the API reports them. */
export type TextSpan = { start: number; end: number };

// Long files render in blocks the browser may skip while they are off screen.
const BLOCK_CHARS = 20_000;

type Piece = { text: string; marked: boolean };

/**
 * The source text split around the marked span, with UTF-16 indexes for JavaScript strings, and
 * cut into blocks so a huge file does not lay out at once. Pure, for tests.
 */
export function textPieces(text: string, span: TextSpan | null): Piece[][] {
  const start = span ? utf16Index(text, span.start) : -1;
  const end = span ? Math.max(start, utf16Index(text, span.end)) : -1;
  const blocks: Piece[][] = [];
  for (let from = 0; from < text.length; from += BLOCK_CHARS) {
    const to = Math.min(text.length, from + BLOCK_CHARS);
    const pieces: Piece[] = [];
    const cuts = [from, ...[start, end].filter((c) => c > from && c < to), to];
    for (let i = 0; i + 1 < cuts.length; i += 1) {
      const [a, b] = [cuts[i], cuts[i + 1]];
      if (b > a) pieces.push({ text: text.slice(a, b), marked: span !== null && a >= start && b <= end && end > start });
    }
    blocks.push(pieces);
  }
  return blocks;
}

function firstMarked(blocks: Piece[][]): [number, number] | null {
  for (const [index, pieces] of blocks.entries()) {
    const n = pieces.findIndex((piece) => piece.marked);
    if (n >= 0) return [index, n];
  }
  return null;
}

/** TXT and Markdown as the source text, never rendered as markdown; the cited span is lit. */
export function TextViewer({ documentId, span, onMissing }: { documentId: string; span: TextSpan | null; onMissing?: () => void }) {
  const t = useTranslations('viewer.text');
  const codeText = useCodeText();
  const { data, error, isPending } = useDocumentText(documentId);
  const blocks = useMemo(() => (data === undefined ? [] : textPieces(data, span)), [data, span]);
  const mark = useRef<HTMLElement>(null);
  const missing = error instanceof ApiError && [404, 410].includes(error.status);

  useEffect(() => {
    if (missing) onMissing?.();
  }, [missing, onMissing]);

  useEffect(() => {
    mark.current?.scrollIntoView?.({ block: 'center' });
  }, [blocks]);

  if (isPending) {
    return (
      <div className="grid h-full place-items-center">
        <DelayedSpinner label={t('loading')} className="size-5" />
      </div>
    );
  }
  if (error) {
    if (missing && onMissing) return null;
    return (
      <p role="alert" className="p-6 text-body text-ink-muted">
        {codeText.error(error instanceof ApiError ? error.code : 'UNKNOWN_ERROR')}
      </p>
    );
  }
  const firstMark = firstMarked(blocks);
  return (
    <div tabIndex={0} aria-label={t('label')} className="h-full overflow-y-auto overscroll-contain focus-visible:outline-2">
      <pre className="px-6 pt-6 pb-16 font-mono text-footnote leading-5 break-words whitespace-pre-wrap text-ink">
        {blocks.map((pieces, index) => (
          <span key={index} className={blocks.length > 1 ? '[contain-intrinsic-size:auto_600px] [content-visibility:auto] block' : undefined}>
            {pieces.map((piece, n) => {
              if (!piece.marked) return piece.text;
              const ref = firstMark?.[0] === index && firstMark[1] === n ? mark : undefined;
              return (
                <mark key={n} ref={ref} className="text-mark rounded-xs">
                  {piece.text}
                </mark>
              );
            })}
          </span>
        ))}
      </pre>
    </div>
  );
}
