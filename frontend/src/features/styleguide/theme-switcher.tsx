'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { applyTheme } from '@/shared/preferences/apply-theme';
import type { Theme } from '@/shared/preferences/cookies';
import { SegmentedControl } from '@/shared/ui';

export function ThemeSwitcher({ initial }: { initial: Theme }) {
  const t = useTranslations('styleguide');
  const [theme, setTheme] = useState<Theme>(initial);
  return (
    <SegmentedControl
      label={t('theme')}
      value={theme}
      onValueChange={(next) => {
        setTheme(next);
        applyTheme(next);
      }}
      options={[
        { value: 'light', label: t('themeLight') },
        { value: 'dark', label: t('themeDark') },
        { value: 'system', label: t('themeSystem') },
      ]}
    />
  );
}
