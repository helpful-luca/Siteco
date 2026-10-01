'use client';

import { useTranslations } from 'next-intl';
import type { SourceOut } from '@/shared/api/types';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { Button } from '@/shared/ui';

type Props = { sources: SourceOut[]; onOpen: (source: SourceOut) => void };

/** Without an API key: the passages that match the question, each one openable. */
export function SourcesOnlyCard({ sources, onOpen }: Props) {
  const t = useTranslations('chat.sources');
  const text = useCodeText();
  return (
    <section aria-labelledby="sources-only-title" className="rounded-card bg-surface p-4 shadow-float ring-1 ring-hairline">
      <h3 id="sources-only-title" className="text-body font-medium">
        {t('onlyTitle')}
      </h3>
      <p className="mt-1 max-w-[60ch] text-footnote text-ink-muted">
        {sources.length > 0 ? t('onlyText', { count: sources.length }) : null} {text.notice('LLM_NOT_CONFIGURED')}
      </p>
      {sources.length > 0 && (
        <ol className="mt-3 divide-y divide-hairline">
          {[...sources]
            .sort((a, b) => a.index - b.index)
            .map((source) => (
              <li key={source.id} className="flex items-start gap-3 py-3 last:pb-0">
                <span className="mt-0.5 inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-fill-strong text-[11px] font-semibold text-ink tabular-nums">
                  {source.index}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-footnote font-medium">
                    {source.filename}
                    <span className="font-normal text-ink-muted">
                      {', '}
                      {source.page !== null ? t('page', { page: source.page }) : t('passage')}
                    </span>
                  </p>
                  <p className="mt-1 line-clamp-3 text-body text-ink-muted">{source.snippet}</p>
                </div>
                <Button
                  size="sm"
                  className="-my-0.5 -mr-1"
                  disabled={source.deleted}
                  aria-label={t('openOf', { file: source.filename })}
                  onClick={() => onOpen(source)}
                >
                  {t('open')}
                </Button>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}
