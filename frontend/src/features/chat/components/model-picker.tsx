'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useConfig } from '@/shared/api/use-config';
import { useChatSettings } from '../chat-settings';
import { cn, Menu, MenuLabel, MenuRadioGroup, MenuRadioItem, ToolbarButton, Tooltip } from '@/shared/ui';
import { modelLabel, priceLevel } from '../format';

type Props = {
  value: string | null;
  onChange: (model: string) => void;
  /** The other column's model in the comparison mode: not selectable here. */
  exclude?: string | null;
  /** The second picker of a comparison; errors open only the first one. */
  second?: boolean;
};

/** Model for the next question: name, a quiet $ level and one line on what it is for. Off without a key. */
export function ModelPicker({ value, onChange, exclude = null, second = false }: Props) {
  const t = useTranslations('chat.model');
  const { data: config } = useConfig();
  const settings = useChatSettings();
  const [ownOpen, setOwnOpen] = useState(false);
  const pickerOpen = second ? ownOpen : settings.pickerOpen;
  const setPickerOpen = second ? setOwnOpen : settings.setPickerOpen;
  const label = second ? t('secondLabel') : t('label');
  const models = config?.models ?? [];
  if (!config || models.length === 0) return null;

  if (config.features.retrieval_only) {
    return (
      <Tooltip content={t('noKey')}>
        <ToolbarButton aria-disabled="true" aria-label={`${label}: ${t('noKey')}`} className="opacity-50 hover:bg-transparent">
          {modelLabel(models, value)}
          <ChevronDown aria-hidden className="opacity-60" />
        </ToolbarButton>
      </Tooltip>
    );
  }

  return (
    <Menu
      align="end"
      side="top"
      className="w-80"
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      trigger={
        <ToolbarButton aria-label={`${label}: ${modelLabel(models, value)}`}>
          <span className="truncate">{modelLabel(models, value)}</span>
          <ChevronDown aria-hidden className="opacity-60" />
        </ToolbarButton>
      }
    >
      <MenuLabel>{label}</MenuLabel>
      <MenuRadioGroup value={value ?? ''} onValueChange={onChange}>
        {models.map((model) => {
          const level = priceLevel(models, model.id);
          return (
            <MenuRadioItem key={model.id} value={model.id} disabled={!model.available || model.id === exclude}>
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
                {!model.available
                  ? t('unavailable')
                  : model.id === exclude
                    ? t('inOtherColumn')
                    : t.has(`tier.${model.tier}`)
                      ? t(`tier.${model.tier}`)
                      : model.tier}
              </span>
            </MenuRadioItem>
          );
        })}
      </MenuRadioGroup>
    </Menu>
  );
}
