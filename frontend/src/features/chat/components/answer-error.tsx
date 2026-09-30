'use client';

import { AlertCircle, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { Button, cn, CopyButton } from '@/shared/ui';
import type { RunError } from '../stream/stream-reducer';

type Props = { error: RunError; onRetry?: () => void };

/**
 * A failed answer (annex 10, 3.3). Without text it is a card that takes the answer's place;
 * after partial text it is one line below it. Both offer to try again and to copy the error id.
 */
export function AnswerError({ error, onRetry }: Props) {
  const t = useTranslations('chat.answer');
  const text = useCodeText();
  const params = Object.fromEntries(
    Object.entries(error.params).map(([key, value]) => [key, typeof value === 'number' ? value : String(value)]),
  );
  const message = text.error(error.code, { seconds: error.retryAfter ?? 0, ...params });
  return (
    <div
      role="alert"
      className={cn(
        'flex max-w-[68ch] flex-col items-start gap-3',
        !error.partial && 'rounded-card bg-fill px-4 py-3 ring-1 ring-inset ring-hairline',
      )}
    >
      <p className="flex gap-2 text-footnote">
        <AlertCircle aria-hidden className="mt-px size-4 shrink-0 text-danger" />
        <span>{message}</span>
      </p>
      {(onRetry || error.requestId) && (
        <div className="-ml-3 flex flex-wrap items-center gap-1">
          {onRetry && (
            <Button size="sm" variant="ghost" onClick={onRetry}>
              <RotateCcw aria-hidden />
              {t('retry')}
            </Button>
          )}
          {error.requestId && (
            <span className="flex items-center gap-0.5 pl-3 text-caption text-ink-muted">
              {t('errorId', { id: error.requestId })}
              <CopyButton text={error.requestId} label={t('copyErrorId')} copiedLabel={t('copied')} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
