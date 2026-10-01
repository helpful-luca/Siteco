'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { OnboardingOverlay } from '@/features/onboarding';
import type { Locale, Theme } from '@/shared/preferences/cookies';
import { Badge, Button, Dialog, DialogClose, SegmentedControl, Spinner, Switch, Tooltip } from '@/shared/ui';

const SWATCHES = [
  'canvas',
  'surface',
  'ink',
  'ink-muted',
  'accent',
  'accent-ink',
  'highlight',
  'success',
  'danger',
] as const;

export function ComponentSheet({ theme, startOnboarding = false }: { theme: Theme; startOnboarding?: boolean }) {
  const t = useTranslations('styleguide.sheet');
  const locale = useLocale() as Locale;
  const [compare, setCompare] = useState(true);
  const [onboarding, setOnboarding] = useState(startOnboarding);
  const [language, setLanguage] = useState<'de' | 'en'>('de');

  return (
    <div className="mx-auto grid max-w-[calc(var(--container-page)+2*var(--gutter))] gap-x-12 gap-y-12 px-gutter pt-12 pb-24 md:grid-cols-2">
      <Section title={t('actions')}>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">{t('primary')}</Button>
          <Button variant="secondary">{t('secondary')}</Button>
          <Button variant="ghost">{t('ghost')}</Button>
          <Button variant="danger">
            <Trash2 aria-hidden />
            {t('danger')}
          </Button>
          <Button icon variant="secondary" aria-label={t('primary')}>
            <Plus />
          </Button>
          <Button variant="primary" disabled>
            {t('primary')}
          </Button>
        </div>
      </Section>

      <Section title={t('inputs')}>
        <div className="flex flex-col items-start gap-5">
          <SegmentedControl
            label={t('language')}
            value={language}
            onValueChange={setLanguage}
            options={[
              { value: 'de', label: 'Deutsch' },
              { value: 'en', label: 'English' },
            ]}
          />
          <Switch label={t('compare')} checked={compare} onCheckedChange={setCompare} />
          <NameField label={t('nameLabel')} placeholder={t('namePlaceholder')} />
        </div>
      </Section>

      <Section title={t('status')}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="ready">{t('ready')}</Badge>
          <Badge tone="working">{t('working')}</Badge>
          <Badge tone="failed">{t('failed')}</Badge>
          <Badge tone="neutral">{t('queued')}</Badge>
          <Spinner label={t('working')} />
        </div>
      </Section>

      <Section title={t('overlays')}>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => setOnboarding(true)}>
            {t('openDialog')}
          </Button>
          <OnboardingOverlay
            open={onboarding}
            initial={{ locale, theme, name: '' }}
            onDone={() => setOnboarding(false)}
          />
          <Dialog
            title={t('dialogTitle')}
            description={t('dialogDescription')}
            trigger={<Button variant="secondary">{t('dialogDemo')}</Button>}
          >
            <div className="flex flex-col items-start gap-5">
              <SegmentedControl
                label={t('language')}
                value={language}
                onValueChange={setLanguage}
                options={[
                  { value: 'de', label: 'Deutsch' },
                  { value: 'en', label: 'English' },
                ]}
              />
              <NameField label={t('nameLabel')} placeholder={t('namePlaceholder')} />
              <div className="flex w-full justify-end gap-2 pt-2">
                <DialogClose render={<Button variant="ghost">{t('skip')}</Button>} />
                <DialogClose render={<Button variant="primary">{t('continue')}</Button>} />
              </div>
            </div>
          </Dialog>
          <Tooltip content={t('tooltipText')}>
            <Button variant="ghost">{t('tooltip')}</Button>
          </Tooltip>
        </div>
      </Section>

      <Section title={t('tokens')} wide>
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
          {SWATCHES.map((name) => (
            <li key={name} className="flex flex-col gap-2">
              <span
                className="h-14 rounded-card ring-1 ring-inset ring-hairline"
                style={{ background: `var(--c-${name})` }}
              />
              <span className="text-caption text-ink-muted">{name}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, wide = false, children }: { title: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={wide ? 'md:col-span-2' : undefined}>
      <h2 className="mb-4 text-title-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function NameField({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <label className="flex w-full max-w-96 flex-col gap-2">
      <span className="text-footnote font-medium text-ink-muted">{label}</span>
      <input
        placeholder={placeholder}
        maxLength={40}
        className="h-10 rounded-control bg-fill px-3 text-body ring-1 pointer-coarse:h-11 ring-inset ring-hairline outline-none transition-shadow placeholder:text-ink-muted focus:ring-2 focus:ring-accent"
      />
    </label>
  );
}
