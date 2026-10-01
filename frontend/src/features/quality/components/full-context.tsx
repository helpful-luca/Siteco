'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { EvalOut } from '@/shared/api/types';
import { FormGroup, FormRow } from '@/shared/ui';
import { formatShare } from '../format';

/** Top passages against the whole document, for chats limited to one small document (4.5). */
export function FullContext({ result, limit }: { result: EvalOut['full_context']; limit: number }) {
  const t = useTranslations('quality.fullContext');
  const locale = useLocale();
  const tokens = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
  return (
    <FormGroup
      title={t('title')}
      footer={
        <>
          {t('footer', { limit: tokens(limit), questions: result.questions })}
          {result.retrieval_tokens >= result.full_context_tokens * 0.95 && <> {t('same')}</>}
        </>
      }
    >
      <FormRow label={t('retrieval')} description={t('tokens', { tokens: tokens(result.retrieval_tokens) })}>
        <span className="text-body tabular-nums">{formatShare(result.retrieval_in_sources, locale)}</span>
      </FormRow>
      <FormRow label={t('whole')} description={t('tokens', { tokens: tokens(result.full_context_tokens) })}>
        <span className="text-body tabular-nums">{formatShare(result.full_context_in_sources, locale)}</span>
      </FormRow>
    </FormGroup>
  );
}
