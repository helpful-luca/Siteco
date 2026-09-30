'use client';

import { ChevronDown, ChevronUp, Minus, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, Tooltip } from '@/shared/ui';
import { ZOOM_STEPS } from './page-layout';

type Props = {
  page: number;
  pages: number;
  zoom: number;
  onPage: (page: number) => void;
  onZoom: (direction: 1 | -1) => void;
  onFit: () => void;
};

/** Floating glass pill over the pages, like Preview: page up and down, page field, zoom. Dense
 * glass: it sits on white paper in both themes and must stay readable there. */
export function ViewerToolbar({ page, pages, zoom, onPage, onZoom, onFit }: Props) {
  const t = useTranslations('viewer.pdf');
  const [draft, setDraft] = useState<string | null>(null);
  const percent = Math.round(zoom * 100);

  const commit = () => {
    const number = Number.parseInt(draft ?? '', 10);
    if (Number.isFinite(number)) onPage(Math.min(Math.max(1, number), pages));
    setDraft(null);
  };

  return (
    <div
      role="toolbar"
      aria-label={t('toolbar')}
      className="glass-dense absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full px-1 py-1"
    >
      <Tooltip content={t('previous')}>
        <Button icon variant="ghost" size="sm" aria-label={t('previous')} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronUp />
        </Button>
      </Tooltip>
      <label className="flex items-center gap-1 text-footnote text-ink-muted tabular-nums">
        <input
          aria-label={t('pageField')}
          value={draft ?? String(page)}
          inputMode="numeric"
          onFocus={(event) => {
            setDraft(String(page));
            event.currentTarget.select();
          }}
          onChange={(event) => setDraft(event.currentTarget.value.replace(/\D/g, ''))}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commit();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault(); // cancels the edit only, the panel stays open
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
          style={{ width: `${Math.max(2, String(pages).length) + 1}ch` }}
          className="h-7 rounded-inner bg-fill text-center text-footnote text-ink outline-none focus-visible:outline-2 pointer-coarse:h-11"
        />
        <span aria-hidden>/</span>
        <span>{pages}</span>
      </label>
      <Tooltip content={t('next')}>
        <Button icon variant="ghost" size="sm" aria-label={t('next')} disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronDown />
        </Button>
      </Tooltip>
      <span aria-hidden className="mx-1 h-4 w-px bg-hairline" />
      <Tooltip content={t('zoomOut')}>
        <Button icon variant="ghost" size="sm" aria-label={t('zoomOut')} disabled={zoom <= ZOOM_STEPS[0]} onClick={() => onZoom(-1)}>
          <Minus />
        </Button>
      </Tooltip>
      <Tooltip content={t('fitWidth')}>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('fitWidthAt', { percent })}
          onClick={onFit}
          className="min-w-14 px-2 tabular-nums"
        >
          {percent} %
        </Button>
      </Tooltip>
      <Tooltip content={t('zoomIn')}>
        <Button
          icon
          variant="ghost"
          size="sm"
          aria-label={t('zoomIn')}
          disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
          onClick={() => onZoom(1)}
        >
          <Plus />
        </Button>
      </Tooltip>
    </div>
  );
}
