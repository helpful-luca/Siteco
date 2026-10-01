'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCodeText } from '@/shared/i18n/use-code-text';
import { Button, buttonStyles, Countdown, ErrorId } from '@/shared/ui';
import { useChatSettings } from '../chat-settings';
import type { Refusal } from '../use-refusal';
import { ComposerNotice } from './composer-notice';

const CHOOSE_MODEL = new Set(['MODEL_UNAVAILABLE', 'MODEL_NOT_ALLOWED', 'LLM_FORBIDDEN']);
const NEW_CHAT = new Set(['MESSAGE_LIMIT', 'LLM_CONTEXT_TOO_LARGE']);
const WITH_ID = new Set(['UNKNOWN_ERROR', 'INTERNAL_ERROR']);

type Props = { id: string; refusal: Refusal; onDismiss: () => void; onWaitEnd: () => void };

/**
 * Why the question was not sent, right above the composer: a pause counts down
 * and then says so; other refusals offer the one step that helps.
 */
export function RefusalNotice({ id, refusal, onDismiss, onWaitEnd }: Props) {
  const t = useTranslations('chat.composer');
  const tAnswer = useTranslations('chat.answer');
  const text = useCodeText();
  const { setPickerOpen } = useChatSettings();
  const { error, waitUntil } = refusal;

  if (waitUntil !== null) {
    return (
      <ComposerNotice id={id} tone="wait" onDismiss={onDismiss}>
        <Countdown
          until={waitUntil}
          format={(seconds) => text.error(error.code, { ...error.params, seconds })}
          done={t('waitOver')}
          onEnd={onWaitEnd}
        />
      </ComposerNotice>
    );
  }

  const action = CHOOSE_MODEL.has(error.code) ? (
    <Button size="sm" onClick={() => setPickerOpen(true)}>
      {t('chooseModel')}
    </Button>
  ) : NEW_CHAT.has(error.code) ? (
    <Link href="/chat" className={buttonStyles({ size: 'sm' })}>
      {t('newChat')}
    </Link>
  ) : undefined;

  return (
    <ComposerNotice id={id} tone="error" onDismiss={onDismiss} action={action}>
      <p>{text.error(error.code, error.params, error.retryAfter)}</p>
      {WITH_ID.has(error.code) && error.requestId && (
        <ErrorId
          id={error.requestId}
          label={tAnswer('errorId', { id: error.requestId })}
          copyLabel={tAnswer('copyErrorId')}
          copiedLabel={tAnswer('copied')}
          className="-mb-1.5 mt-0.5"
        />
      )}
    </ComposerNotice>
  );
}
