'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useOnboarding } from '@/features/onboarding';
import { useConfig } from '@/shared/api/use-config';
import { Button, buttonStyles, FormGroup, FormRow } from '@/shared/ui';
import { useReady } from '../queries';
import { useModelPrice } from './models-section';

export function AboutSection() {
  const t = useTranslations('settings.about');
  const models = useTranslations('settings.models');
  const { data: config } = useConfig();
  const { data: ready } = useReady();
  const onboarding = useOnboarding();
  const modelPrice = useModelPrice();
  if (!config) return null;
  const scanOn = config.features.malware_scan !== 'off';

  const value = (text: string, tone?: 'danger') => (
    <span className={tone === 'danger' ? 'text-body text-danger' : 'text-body text-ink-muted'}>{text}</span>
  );

  return (
    <div className="flex flex-col gap-8">
      <FormGroup title={t('app')}>
        <FormRow label={t('version')}>{value(config.version)}</FormRow>
        <FormRow label={t('commit')}>
          <span className="text-body text-ink-muted tabular-nums">{config.commit.slice(0, 12)}</span>
        </FormRow>
        <FormRow label={t('server')}>{value(ready?.ready ? t('serverReady') : t('serverStarting'))}</FormRow>
        <FormRow label={t('claude')}>
          {value(t(`llm.${config.llm_status}`), config.llm_status === 'invalid_key' ? 'danger' : undefined)}
        </FormRow>
        <FormRow label={t('scan')}>{value(scanOn ? t('scanOn') : t('scanOff'), scanOn ? undefined : 'danger')}</FormRow>
      </FormGroup>

      <FormGroup title={t('models')} footer={t('modelsFooter')}>
        {config.models.map((model) => (
          <FormRow
            key={model.id}
            label={model.label}
            description={model.available ? modelPrice(model) : models('unavailable')}
          />
        ))}
      </FormGroup>

      <FormGroup title={t('more')}>
        <FormRow label={t('quality')} description={t('qualityText')}>
          <Link href="/quality" className={buttonStyles()}>
            {t('open')}
          </Link>
        </FormRow>
        <FormRow label={t('setup')} description={t('setupText')}>
          <Button onClick={onboarding.open}>{t('setupAction')}</Button>
        </FormRow>
      </FormGroup>
    </div>
  );
}
