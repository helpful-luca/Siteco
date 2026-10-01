'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { FormGroup, FormText } from '@/shared/ui';
import { useWorkspace } from '../queries';
import { sectionHref } from '../sections';

/** Plain-language privacy notice (master spec 10b, 3; Art. 13 GDPR). */
export function PrivacySection() {
  const t = useTranslations('settings.privacy');
  const { data: workspace } = useWorkspace();
  const retention = workspace?.retention_days ?? null;

  return (
    <div className="flex flex-col gap-8">
      <FormGroup title={t('local')}>
        <FormText>{t('localDocuments')}</FormText>
        <FormText>{t('localChats')}</FormText>
        <FormText>{t('localProcessing')}</FormText>
        <FormText>{t('localName')}</FormText>
      </FormGroup>
      <FormGroup title={t('sent')}>
        <FormText>{t('sentQuestion')}</FormText>
        <FormText>{t('sentSmall')}</FormText>
        <FormText>{t('sentNever')}</FormText>
      </FormGroup>
      <FormGroup title={t('anthropic')}>
        <FormText>{t('anthropicText')}</FormText>
      </FormGroup>
      <FormGroup title={t('telemetry')}>
        <FormText>{t('telemetryText')}</FormText>
      </FormGroup>
      <FormGroup title={t('scan')}>
        <FormText>{t('scanOn')}</FormText>
      </FormGroup>
      <FormGroup title={t('rights')}>
        <FormText>{t('rightsText')}</FormText>
        <FormText>{retention === null ? t('retentionOff') : t('retentionOn', { days: retention })}</FormText>
        <FormText>
          <Link href={sectionHref('data')} className="text-sodium-ink underline-offset-2 hover:underline">
            {t('toData')}
          </Link>
        </FormText>
      </FormGroup>
    </div>
  );
}
