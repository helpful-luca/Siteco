'use client';

import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { type Locale, NAME_MAX_CODE_POINTS, sanitizeName, type Theme } from '@/shared/preferences/cookies';
import { Button, ChoiceCards, cn, Flag, ThemeThumbnail, Typewriter } from '@/shared/ui';

export type OnboardingResult = { locale: Locale; theme: Theme; name: string };

type Props = {
  initial: OnboardingResult;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: Theme) => void;
  onFinish: (result: OnboardingResult) => void;
  /** Skipped (button or Escape): the choices made so far, without the name. */
  onSkip: (current: Omit<OnboardingResult, 'name'>) => void;
};

const STEPS = ['language', 'appearance', 'name'] as const;
const SPRING = { type: 'spring', duration: 0.45, bounce: 0 } as const;
/** The greeting alternates between both languages, starting with the current one. */
const GREETINGS = { de: ['Willkommen', 'Welcome'], en: ['Welcome', 'Willkommen'] } as const;

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
      {/*
        A full window like Apple's setup assistant: one decision per screen in a centred column,
        a large title, Skip on the left of the bottom bar, Back and Continue on the right. The top
        56 px stay free for the window buttons and the drag strip of the desktop app.
      */}
      <form onSubmit={submit} className="flex min-h-0 w-full flex-1 flex-col pt-[calc(var(--spacing)*14+var(--window-top))]">
        <p className="sr-only" aria-live="polite">
          {t('progress', { current: step + 1, total: STEPS.length })}
        </p>

        <div className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain px-gutter">
          <div aria-hidden className="min-h-6 flex-2" />
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
              className="mx-auto flex w-full max-w-xl flex-col items-center text-center"
            >
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="text-title-1 font-semibold outline-none sm:text-large-title"
              >
                {current === 'language' ? (
                  <Typewriter label={t('language.title')} words={GREETINGS[initial.locale]} />
                ) : (
                  t(`${current}.title`)
                )}
              </h2>
              {/* One or two short lines: each line of the copy is its own balanced block. */}
              <p className="mt-3 max-w-[48ch] text-reading text-ink-muted">
                {t(`${current}.subtitle`)
                  .split('\n')
                  .map((line) => (
                    <span key={line} className="block text-balance">
                      {line}
                    </span>
                  ))}
              </p>

              <div className="mt-10 w-full sm:mt-12">
                {current === 'language' && (
                  <div className="mx-auto max-w-md">
                    <ChoiceCards
                      label={t('language.label')}
                      value={values.locale}
                      onValueChange={(locale) => {
                        setValues((v) => ({ ...v, locale }));
                        onLocaleChange(locale);
                      }}
                      choices={[
                        { value: 'de', title: 'Deutsch', icon: <Flag country="de" className="h-8" /> },
                        { value: 'en', title: 'English', icon: <Flag country="us" className="h-8" /> },
                      ]}
                    />
                  </div>
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
                      visual: <ThemeThumbnail theme={theme} className="h-20 sm:h-28" />,
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
                      maxLength={NAME_MAX_CODE_POINTS}
                      autoComplete="given-name"
                      placeholder={t('name.placeholder')}
                      className="h-14 rounded-card bg-surface px-4 text-center text-title-3 shadow-[0_1px_2px_rgb(0_0_0/0.04)] ring-1 ring-inset ring-hairline outline-none transition-shadow placeholder:text-ink-muted focus:ring-2 focus:ring-accent dark:bg-fill"
                    />
                    <p className="text-footnote text-ink-muted">{t('name.privacy')}</p>
                  </div>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
          <div aria-hidden className="min-h-6 flex-3" />
        </div>

        <div className="relative flex shrink-0 items-center justify-between gap-4 px-gutter pt-4 pb-6 sm:pb-8">
          {/* Pulled out by its own padding, so the label (not the pill) sits on the gutter. */}
          <Button variant="ghost" className="-ml-4 text-ink-muted hover:text-ink pointer-coarse:-ml-5" onClick={() => onSkip({ locale: values.locale, theme: values.theme })}>
            {t('skip')}
          </Button>
          <div className="absolute left-1/2 hidden -translate-x-1/2 gap-1.5 sm:flex" aria-hidden>
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
              <Button variant="secondary" onClick={() => go(-1)}>
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
