'use client';

import { useTranslations } from 'next-intl';
import { THEMES, type Theme } from '@/shared/preferences/cookies';
import { useInitialPreferences, useStoredPreferences } from '@/shared/preferences/preferences';
import { ChoiceCards, FormGroup, ThemeThumbnail } from '@/shared/ui';
import { SaveError, useSettingSave } from '../use-setting-save';

export function AppearanceSection() {
  const t = useTranslations('settings.appearance');
  const names = useTranslations('onboarding.appearance');
  const initial = useInitialPreferences();
  const { data } = useStoredPreferences();
  const { save, error } = useSettingSave();
  const theme: Theme = data?.onboarded ? data.theme : initial.theme;

  return (
    <div className="flex flex-col">
      <FormGroup title={t('title')} footer={t('footer')}>
        <div className="p-4">
          <ChoiceCards
            label={t('title')}
            value={theme}
            onValueChange={(value) => void save({ theme: value })}
            choices={THEMES.map((value) => ({
              value,
              title: names(value),
              visual: <ThemeThumbnail theme={value} />,
            }))}
          />
        </div>
      </FormGroup>
      <SaveError error={error} />
    </div>
  );
}
