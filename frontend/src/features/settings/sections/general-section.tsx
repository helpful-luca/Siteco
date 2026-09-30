'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { NAME_MAX_CODE_POINTS, sanitizeName, type Locale } from '@/shared/preferences/cookies';
import { usePreferences } from '@/shared/preferences/preferences';
import { FormGroup, FormRow, SegmentedControl, TextInput } from '@/shared/ui';
import { SaveError, useSettingSave } from '../use-setting-save';

const LANGUAGES = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
] as const;

export function GeneralSection() {
  const t = useTranslations('settings.general');
  const locale = useLocale() as Locale;
  const { name } = usePreferences();
  const language = useSettingSave();
  const greeting = useSettingSave();
  const nameId = useId();
  // Edited locally, saved when the field is left or Enter is pressed.
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const commit = async () => {
    if (draft === null) return;
    const clean = sanitizeName(draft);
    setDraft(null);
    if (clean === name) return;
    setSaved(await greeting.save({ name: clean }));
  };

  return (
    <div className="flex flex-col gap-8">
      <FormGroup title={t('language')} footer={t('languageFooter')}>
        <FormRow label={t('languageLabel')}>
          <SegmentedControl
            label={t('languageLabel')}
            value={locale}
            onValueChange={(value) => void language.save({ locale: value })}
            options={LANGUAGES}
          />
        </FormRow>
      </FormGroup>
      <SaveError error={language.error} />

      <FormGroup
        title={t('name')}
        footer={
          <>
            {t('nameFooter')}
            <span aria-live="polite" className="ml-1 text-success">
              {saved && draft === null ? t('saved') : ''}
            </span>
          </>
        }
      >
        <FormRow label={t('nameLabel')} htmlFor={nameId}>
          <TextInput
            id={nameId}
            value={draft ?? name}
            onChange={(event) => {
              setSaved(false);
              setDraft(event.target.value);
            }}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape' && draft !== null) {
                event.stopPropagation(); // the right panel also listens for Escape
                setDraft(null);
              }
            }}
            maxLength={NAME_MAX_CODE_POINTS}
            autoComplete="given-name"
            placeholder={t('namePlaceholder')}
            className="w-56 max-w-full"
          />
        </FormRow>
      </FormGroup>
      <SaveError error={greeting.error} />
    </div>
  );
}
