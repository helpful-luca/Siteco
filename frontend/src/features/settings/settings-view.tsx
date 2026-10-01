'use client';

import { ChevronLeft, ChevronRight, Cpu, HardDrive, Paintbrush, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Page } from '@/features/shell';
import { cn } from '@/shared/ui';
import { type Section, SECTIONS, sectionHref } from './sections';
import { AppearanceSection } from './sections/appearance-section';
import { DataSection } from './sections/data-section';
import { GeneralSection } from './sections/general-section';
import { ModelsSection } from './sections/models-section';
import { PrivacySection } from './sections/privacy-section';

const ICONS: Record<Section, ReactNode> = {
  general: <SlidersHorizontal aria-hidden />,
  appearance: <Paintbrush aria-hidden />,
  models: <Cpu aria-hidden />,
  data: <HardDrive aria-hidden />,
  privacy: <ShieldCheck aria-hidden />,
};

const CONTENT: Record<Section, () => ReactNode> = {
  general: GeneralSection,
  appearance: AppearanceSection,
  models: ModelsSection,
  data: DataSection,
  privacy: PrivacySection,
};

/**
 * Settings like macOS System Settings: the sections on the left, the chosen one on the right.
 * In a narrow column it becomes iOS Settings: the list first, a section with a way back. Every
 * section has its own address (`?section=`), so notices can link straight to it.
 */
export function SettingsView({ section }: { section: Section | null }) {
  const t = useTranslations('settings');
  const active = section ?? 'general';
  const Content = CONTENT[active];

  return (
    <Page>
      <div className="@container">
        <div className="grid gap-x-10 @2xl:grid-cols-[13rem_minmax(0,1fr)]">
          <nav
            aria-label={t('sectionsLabel')}
            className={cn('@2xl:sticky @2xl:top-3 @2xl:self-start', section ? 'hidden @2xl:block' : 'block')}
          >
            <h1 className="text-title-2 font-semibold @2xl:sr-only">{t('title')}</h1>
            <ul
              className={cn(
                'mt-6 rounded-card bg-surface ring-1 ring-inset ring-hairline',
                '@2xl:mt-0 @2xl:flex @2xl:flex-col @2xl:gap-0.5 @2xl:bg-transparent @2xl:ring-0',
              )}
            >
              {SECTIONS.map((id) => {
                const current = id === active;
                return (
                  <li
                    key={id}
                    className={cn(
                      'first:[&>a]:rounded-t-card last:[&>a]:rounded-b-card',
                      'relative not-first:before:absolute not-first:before:top-0 not-first:before:right-0',
                      'not-first:before:left-14 not-first:before:h-px not-first:before:bg-hairline @2xl:before:hidden',
                    )}
                  >
                    <Link
                      href={sectionHref(id)}
                      scroll={false}
                      aria-current={current && section !== null ? 'page' : undefined}
                      className={cn(
                        'flex h-12 items-center gap-3 px-4 text-body transition-colors',
                        'hover:bg-fill',
                        '@2xl:h-8 @2xl:rounded-control @2xl:px-2 pointer-coarse:@2xl:h-11',
                        current && '@2xl:bg-fill-strong @2xl:font-medium',
                      )}
                    >
                      <span
                        className={cn(
                          'grid size-7 shrink-0 place-items-center rounded-inner bg-fill-strong text-ink [&_svg]:size-4',
                          '@2xl:size-6 @2xl:bg-transparent @2xl:[&_svg]:opacity-60',
                          current && '@2xl:text-ink @2xl:[&_svg]:opacity-100',
                        )}
                      >
                        {ICONS[id]}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{t(`sections.${id}`)}</span>
                      <ChevronRight aria-hidden className="size-4 text-ink-muted @2xl:hidden" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className={cn('min-w-0', section ? 'block' : 'hidden @2xl:block')}>
            <Link
              href="/settings"
              className="-ml-2 mb-2 inline-flex h-8 items-center gap-1 rounded-control pr-2 text-body text-accent-ink hover:bg-fill @2xl:hidden pointer-coarse:h-11"
            >
              <ChevronLeft aria-hidden className="size-5" />
              {t('back')}
            </Link>
            <h2 className="text-title-2 font-semibold">{t(`sections.${active}`)}</h2>
            <div className="mt-6 max-w-160">
              <Content />
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}
