'use client';

import { AlertCircle, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { useConfig } from '@/shared/api/use-config';
import { useBackendDown } from '@/shared/api/use-connection';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { deadlineIn } from '@/shared/lib/use-countdown';
import { Button, buttonStyles, cn, Countdown, ErrorId } from '@/shared/ui';
import { useChatSettings } from '../chat-settings';
import { alternateModel } from '../format';
import type { RunError } from '../stream/stream-reducer';

/** Claude is busy or slow: the same question may go through with another model (annex 10, H25). */
const OTHER_MODEL = new Set(['LLM_OVERLOADED', 'LLM_UNAVAILABLE', 'LLM_TIMEOUT']);
/** The chosen model cannot answer: the picker is the fix. */
const CHOOSE_MODEL = new Set(['MODEL_UNAVAILABLE', 'LLM_FORBIDDEN']);
/** Only a fresh chat helps. */
const NEW_CHAT = new Set(['LLM_CONTEXT_TOO_LARGE', 'LLM_BAD_REQUEST']);
/** Claude asked us to wait: trying again is possible once the countdown is over. */
const WAIT = new Set(['LLM_RATE_LIMITED']);

type Props = {
  error: RunError;
  /** The model that failed. */
  model: string | null;
  onRetry?: () => void;
  onRetryWith?: (model: string) => void;
};

/**
 * A failed answer (annex 10, 3.3). Without text it is a card that takes the answer's place;
 * after partial text it is one line below it. It offers the step that helps: try again, another
 * model, the model picker or a new chat, and always the error id when there is one.
 */
export function AnswerError({ error, model, onRetry, onRetryWith }: Props) {
  const t = useTranslations('chat.answer');
  const text = useCodeText();
  const { data: config } = useConfig();
  const { setPickerOpen } = useChatSettings();
  const [waitUntil] = useState(() => (WAIT.has(error.code) && error.retryAfter ? deadlineIn(error.retryAfter) : null));
  const [waiting, setWaiting] = useState(waitUntil !== null);
  // While the backend is away a retry could only fail; the composer note says why.
  const down = useBackendDown();

  const other = OTHER_MODEL.has(error.code) ? alternateModel(config?.models, model, config?.default_model) : null;
  const otherLabel = config?.models.find((m) => m.id === other)?.label;
  const canRetry = onRetry && !NEW_CHAT.has(error.code);

  return (
    <div
      role="alert"
      className={cn(
        'flex max-w-[68ch] flex-col items-start gap-3',
        !error.partial && 'rounded-card bg-fill px-4 py-3 ring-1 ring-inset ring-hairline',
      )}
    >
      <div className="flex gap-2 text-footnote">
        <AlertCircle aria-hidden className="mt-px size-4 shrink-0 text-danger" />
        <p>
          {waitUntil !== null ? (
            <Countdown
              until={waitUntil}
              format={(seconds) => text.error(error.code, { ...error.params, seconds })}
              done={t('waitOver')}
              onEnd={() => setWaiting(false)}
            />
          ) : (
            text.error(error.code, error.params, error.retryAfter)
          )}
        </p>
      </div>
      <div className="-ml-3 flex flex-wrap items-center gap-1">
        {canRetry && (
          <Button size="sm" variant="ghost" onClick={() => onRetry()} disabled={waiting || down}>
            <RotateCcw aria-hidden />
            {t('retry')}
          </Button>
        )}
        {other && onRetryWith && (
          <Button size="sm" variant="ghost" onClick={() => onRetryWith(other)} title={otherLabel} disabled={down}>
            {t('otherModel')}
          </Button>
        )}
        {CHOOSE_MODEL.has(error.code) && (
          <Button size="sm" variant="ghost" onClick={() => setPickerOpen(true)}>
            {t('chooseModel')}
          </Button>
        )}
        {NEW_CHAT.has(error.code) && (
          <Link href="/chat" className={buttonStyles({ size: 'sm', variant: 'ghost' })}>
            {t('newChat')}
          </Link>
        )}
        {error.requestId && (
          <ErrorId
            id={error.requestId}
            label={t('errorId', { id: error.requestId })}
            copyLabel={t('copyErrorId')}
            copiedLabel={t('copied')}
            className="pl-3"
          />
        )}
      </div>
    </div>
  );
}
