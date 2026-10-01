'use client';

import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Check } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { AnswerStyle, Effort, ModelInfo } from '@/shared/api/types';
import { useConfig } from '@/shared/api/use-config';
import { useStoredPreferences } from '@/shared/preferences/preferences';
import { cn, FormGroup, FormRow, SegmentedControl } from '@/shared/ui';
import { SaveError, useSettingSave } from '../use-setting-save';
import { ApiKeyGroup } from './api-key-group';

const EFFORTS: Effort[] = ['low', 'medium', 'high'];
const STYLES: AnswerStyle[] = ['concise', 'detailed'];

function usePrice() {
  const format = useFormatter();
  return (usd: number) =>
    format.number(usd, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
}

/** Price per million tokens, for the model list here and in Info. */
export function useModelPrice() {
  const t = useTranslations('settings.models');
  const price = usePrice();
  return (model: ModelInfo) =>
    t('price', {
      input: price(model.input_usd_per_mtok),
      output: price(model.output_usd_per_mtok),
    });
}

export function ModelsSection() {
  const t = useTranslations('settings.models');
  const tiers = useTranslations('chat.model.tier');
  const { data: config } = useConfig();
  const { data: prefs } = useStoredPreferences();
  const models = config?.models ?? [];
  const modelPrice = useModelPrice();
  const choice = useSettingSave();
  const answers = useSettingSave();
  if (!config || !prefs) return null;

  const current = models.find((m) => m.id === prefs.default_model);
  const hasEffort = (current?.efforts.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-8">
      <ApiKeyGroup />
      <div>
        <FormGroup title={t('default')} footer={config.features.retrieval_only ? t('noKey') : t('defaultFooter')}>
          <RadioGroup
            aria-label={t('default')}
            value={prefs.default_model}
            onValueChange={(value) => void choice.save({ default_model: value as string })}
          >
            {models.map((model) => (
              <Radio.Root
                key={model.id}
                value={model.id}
                disabled={!model.available}
                className={cn(
                  'group relative flex w-full items-center gap-3 px-4 py-3 text-left outline-none',
                  'first:rounded-t-card last:rounded-b-card hover:bg-fill data-disabled:opacity-50',
                  'focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent',
                  'not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-4',
                  'not-first:before:h-px not-first:before:bg-hairline',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body">{model.label}</span>
                  <span className="mt-0.5 block text-footnote text-ink-muted">
                    {model.available ? (tiers.has(model.tier) ? tiers(model.tier) : model.tier) : t('unavailable')}
                    <span className="block">{modelPrice(model)}</span>
                  </span>
                </span>
                <Check
                  aria-hidden
                  className="size-4 shrink-0 text-accent-ink opacity-0 group-data-checked:opacity-100"
                />
              </Radio.Root>
            ))}
          </RadioGroup>
        </FormGroup>
        <SaveError error={choice.error} />
      </div>

      <div>
        <FormGroup
          title={t('answers')}
          footer={hasEffort ? t('modeFooter') : t('modeFixed', { model: current?.label ?? prefs.default_model })}
        >
          {hasEffort && (
            <FormRow stretch label={t('mode')}>
              <SegmentedControl
                className="w-full sm:w-auto [&>*]:min-w-0 [&>*]:flex-1 sm:[&>*]:min-w-20 sm:[&>*]:flex-none"
                label={t('mode')}
                value={prefs.effort}
                onValueChange={(effort) => void answers.save({ effort })}
                options={EFFORTS.map((value) => ({
                  value,
                  label: t(`modes.${value}`),
                }))}
              />
            </FormRow>
          )}
          <FormRow stretch label={t('length')}>
            <SegmentedControl
              className="w-full sm:w-auto [&>*]:min-w-0 [&>*]:flex-1 sm:[&>*]:min-w-20 sm:[&>*]:flex-none"
              label={t('length')}
              value={prefs.style}
              onValueChange={(style) => void answers.save({ style })}
              options={STYLES.map((value) => ({
                value,
                label: t(`lengths.${value}`),
              }))}
            />
          </FormRow>
        </FormGroup>
        <SaveError error={answers.error} />
      </div>
    </div>
  );
}
