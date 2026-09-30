'use client';

import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import type { Locale, Theme } from '@/shared/preferences/cookies';
import { Button, cn } from '@/shared/ui';
import { ChoiceCards } from './choice-card';
import { ThemeThumbnail } from './theme-thumbnail';

export type OnboardingResult = { locale: Locale; theme: Theme; name: string };

type Props = {
  initial: OnboardingResult;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: Theme) => void;
  onFinish: (result: OnboardingResult) => void;
  onSkip: () => void;
};

const STEPS = ['language', 'appearance', 'name'] as const;
const NAME_MAX = 40;
const SPRING = { type: 'spring', duration: 0.45, bounce: 0 } as const;

/** The name is only shown back to the user as React text; still keep it clean and short. */
export function sanitizeName(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .trim()
    .slice(0, NAME_MAX);
}

/** Three-step setup in the spirit of Apple's setup assistant. Choices apply live via callbacks. */
export function OnboardingFlow({ initial, onLocaleChange, onThemeChange, onFinish, onSkip }: Props) {
  const t = useTranslations('onboarding');
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [values, setValues] = useState(initial);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameId = useId();
  const isLast = step === STEPS.length - 1;

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const go = (delta: 1 | -1) => {
    setDirection(delta);
    setStep((current) => Math.min(Math.max(current + delta, 0), STEPS.length - 1));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (isLast) onFinish({ ...values, name: sanitizeName(values.name) });
    else go(1);
  };

  const current = STEPS[step];

  return (
    <MotionConfig reducedMotion="user">
      <form
        onSubmit={submit}
        className="glass-dense relative flex w-[min(640px,calc(100vw-var(--spacing)*8))] flex-col overflow-hidden rounded-panel"
      >
        <div className="flex items-center justify-between px-6 pt-4 sm:px-8">
          <p className="text-caption text-ink-muted" aria-live="polite">
            {t('progress', { current: step + 1, total: STEPS.length })}
          </p>
          {/* Pulled out by its own padding, so the label (not the pill) sits on the gutter. */}
          <Button variant="ghost" size="sm" className="-mr-3" onClick={onSkip}>
            {t('skip')}
          </Button>
        </div>

        <div className="relative min-h-75 overflow-hidden px-6 pt-6 pb-4 sm:px-8">
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.div
              key={current}
              custom={direction}
              variants={{
                enter: (d: number) => ({ opacity: 0, x: d * 48 }),
                center: { opacity: 1, x: 0 },
                exit: (d: number) => ({ opacity: 0, x: d * -48 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={SPRING}
              className="flex flex-col items-center text-center"
            >
              <h2 ref={headingRef} tabIndex={-1} className="text-title-1 font-semibold outline-none">
                {t(`${current}.title`)}
              </h2>
              <p className="mt-3 max-w-[46ch] text-body text-ink-muted">{t(`${current}.subtitle`)}</p>

              <div className="mt-8 w-full">
                {current === 'language' && (
                  <ChoiceCards
                    label={t('language.label')}
                    value={values.locale}
                    onValueChange={(locale) => {
                      setValues((v) => ({ ...v, locale }));
                      onLocaleChange(locale);
                    }}
                    choices={[
                      { value: 'de', title: 'Deutsch', hint: 'Deutschland, Österreich, Schweiz' },
                      { value: 'en', title: 'English', hint: 'International' },
                    ]}
                  />
                )}

                {current === 'appearance' && (
                  <ChoiceCards
                    label={t('appearance.label')}
                    value={values.theme}
                    onValueChange={(theme) => {
                      setValues((v) => ({ ...v, theme }));
                      onThemeChange(theme);
                    }}
                    choices={(['light', 'dark', 'system'] as const).map((theme) => ({
                      value: theme,
                      title: t(`appearance.${theme}`),
                      visual: <ThemeThumbnail theme={theme} />,
                    }))}
                  />
                )}

                {current === 'name' && (
                  <div className="mx-auto flex max-w-sm flex-col items-stretch gap-4">
                    <label htmlFor={nameId} className="sr-only">
                      {t('name.label')}
                    </label>
                    <input
                      id={nameId}
                      value={values.name}
                      onChange={(event) => setValues((v) => ({ ...v, name: event.target.value }))}
                      maxLength={NAME_MAX}
                      autoComplete="given-name"
                      placeholder={t('name.placeholder')}
                      className="h-12 rounded-control bg-fill px-4 text-center text-title-3 ring-1 ring-inset ring-hairline outline-none transition-shadow placeholder:text-ink-muted focus:ring-2 focus:ring-sodium"
                    />
                    <p className="text-caption text-ink-muted">{t('name.privacy')}</p>
                  </div>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between gap-4 px-6 pt-4 pb-6 sm:px-8">
          <div className="flex gap-1.5" aria-hidden>
            {STEPS.map((name, index) => (
              <span
                key={name}
                className={cn(
                  'h-1.5 rounded-full transition-[width,background-color] duration-300 ease-out-soft',
                  index === step ? 'w-5 bg-ink' : 'w-1.5 bg-fill-strong',
                )}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="ghost" onClick={() => go(-1)}>
                {t('back')}
              </Button>
            )}
            <Button variant="primary" type="submit" className="min-w-28">
              {isLast ? t('finish') : t('continue')}
            </Button>
          </div>
        </div>
      </form>
    </MotionConfig>
  );
}
