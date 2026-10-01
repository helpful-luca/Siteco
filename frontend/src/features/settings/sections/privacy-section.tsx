'use client';

import { useTranslations } from 'next-intl';
import { FormGroup, FormText } from '@/shared/ui';

/** Plain-language privacy notice (master spec 10b, 3; Art. 13 GDPR). */
export function PrivacySection() {
  const t = useTranslations('settings.privacy');

  return (
    <div className="flex flex-col gap-8">
      <FormGroup title={t('local')} footer={t('telemetry')}>
        <FormText>{t('localDocuments')}</FormText>
        <FormText>{t('localChats')}</FormText>
        <FormText>{t('localProcessing')}</FormText>
        <FormText>{t('localName')}</FormText>
      </FormGroup>
      <FormGroup title={t('sent')} footer={t('sentNever')}>
        <FormText>{t('sentQuestion')}</FormText>
        <FormText>{t('sentSmall')}</FormText>
        <FormText>{t('anthropicText')}</FormText>
      </FormGroup>
    </div>
  );
}
