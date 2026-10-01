'use client';

import { Columns2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useConfig } from '@/shared/api/use-config';
import { cn, ToolbarButton, Tooltip } from '@/shared/ui';
import { useChatSettings } from '../chat-settings';
import { ModelPicker } from './model-picker';

/**
 * Model choice in the chat toolbar: "Vergleichen" and the model picker (annex 11, 8.6). With the
 * comparison on, the next question goes to two models side by side and a second picker appears.
 * The comparison is off without a key or with fewer than two models that answer.
 */
export function ModelControls() {
  const t = useTranslations('chat.compare');
  const { data: config } = useConfig();
  const settings = useChatSettings();
  const first = (
    <ModelPicker
      value={settings.model}
      onChange={settings.setModel}
      exclude={settings.compare ? settings.compareModel : null}
    />
  );
  if (!config || config.models.length < 2) return first;
  const possible = !config.features.retrieval_only && settings.compareModel !== null;
  const on = settings.compare;
  const label = possible ? (on ? t('off') : t('on')) : t('unavailable');

  return (
    <>
      <Tooltip content={label}>
        <ToolbarButton
          aria-label={t('toggle')}
          aria-pressed={on}
          aria-disabled={!possible || undefined}
          onClick={() => possible && settings.setCompare(!on)}
          className={cn(
            on && 'bg-highlight text-sodium-ink hover:bg-highlight hover:text-sodium-ink',
            !possible && 'opacity-50 hover:bg-transparent',
          )}
        >
          <Columns2 aria-hidden />
        </ToolbarButton>
      </Tooltip>
      {first}
      {on && (
        <ModelPicker
          second
          value={settings.compareModel}
          onChange={settings.setCompareModel}
          exclude={settings.model}
        />
      )}
    </>
  );
}
