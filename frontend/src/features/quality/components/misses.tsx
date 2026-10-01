'use client';

import { useTranslations } from 'next-intl';
import type { EvalMissOut } from '@/shared/api/types';
import { FormGroup, FormText } from '@/shared/ui';

/** Where the default configuration does not give the answer the right page: the honest part. */
export function Misses({ misses }: { misses: EvalMissOut[] }) {
  const t = useTranslations('quality.misses');
  return (
    <FormGroup title={t('title')} footer={t('footer')}>
      {misses.length === 0 ? (
        <FormText className="text-ink-muted">{t('none')}</FormText>
      ) : (
        misses.map((miss) => (
          <FormText key={miss.question_id}>
            <span className="block">{miss.question}</span>
            <span className="mt-0.5 block text-footnote text-ink-muted">
              {t(`category.${miss.category}`)}, {miss.rank ? t('rank', { rank: miss.rank }) : t('notFound')}
            </span>
          </FormText>
        ))
      )}
    </FormGroup>
  );
}
