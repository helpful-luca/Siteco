'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useConfig } from '@/shared/api/use-config';
import { cn, Menu, MenuLabel, MenuRadioGroup, MenuRadioItem, ToolbarButton, Tooltip } from '@/shared/ui';
import { modelLabel, priceLevel } from '../format';

type Props = { value: string | null; onChange: (model: string) => void };

/** Model for the next question with a quiet price level (master spec 6.4). Off without a key. */
export function ModelPicker({ value, onChange }: Props) {
  const t = useTranslations('chat.model');
  const { data: config } = useConfig();
  const models = config?.models ?? [];
  if (!config || models.length === 0) return null;

  if (config.features.retrieval_only) {
    return (
      <Tooltip content={t('noKey')}>
        <ToolbarButton aria-disabled="true" aria-label={`${t('label')}: ${t('noKey')}`} className="opacity-50 hover:bg-transparent">
          {modelLabel(models, value)}
          <ChevronDown aria-hidden className="opacity-60" />
        </ToolbarButton>
      </Tooltip>
    );
  }

  return (
    <Menu
      align="end"
      className="w-80"
      trigger={
        <ToolbarButton aria-label={`${t('label')}: ${modelLabel(models, value)}`}>
          <span className="truncate">{modelLabel(models, value)}</span>
          <ChevronDown aria-hidden className="opacity-60" />
        </ToolbarButton>
      }
    >
      <MenuLabel>{t('label')}</MenuLabel>
      <MenuRadioGroup value={value ?? ''} onValueChange={onChange}>
        {models.map((model) => {
          const level = priceLevel(models, model.id);
          return (
            <MenuRadioItem key={model.id} value={model.id} disabled={!model.available}>
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate">{model.label}</span>
                <span aria-hidden className="shrink-0 text-footnote tracking-wider text-ink-muted">
                  {[1, 2, 3].map((step) => (
                    <span key={step} className={cn(step > level && 'opacity-30')}>
                      $
                    </span>
                  ))}
                </span>
              </span>
              <span className="block text-caption text-ink-muted">
                {t.has(`tier.${model.tier}`) ? t(`tier.${model.tier}`) : model.tier}
              </span>
              <span className="block text-caption text-ink-muted">
                {t('price', { input: model.input_usd_per_mtok, output: model.output_usd_per_mtok })}
              </span>
            </MenuRadioItem>
          );
        })}
      </MenuRadioGroup>
    </Menu>
  );
}
