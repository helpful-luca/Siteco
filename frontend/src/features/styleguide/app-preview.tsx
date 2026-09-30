'use client';

import {
  ArrowUp,
  BookOpen,
  ChevronDown,
  FileText,
  Gauge,
  Paperclip,
  Search,
  Settings,
  SquarePen,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, cn, Tooltip } from '@/shared/ui';
import { CitationChip } from './citation-chip';

const CHATS_TODAY = ['a', 'b'] as const;
const CHATS_WEEK = ['c', 'd'] as const;
const DOC_ROWS = ['ip', 'ik', 'flux', 'cct', 'weight', 'temp'] as const;

/** Static but interactive preview of the product shell. Real app screens reuse these patterns. */
export function AppPreview() {
  const t = useTranslations('styleguide');
  const [activeSource, setActiveSource] = useState<1 | 2 | null>(1);
  const highlightedRow = activeSource === 1 ? 'ip' : activeSource === 2 ? 'ik' : null;

  return (
    <div className="flex h-full gap-3 p-3">
      {/* Sidebar: glass, floats above the light pool */}
      <aside className="glass hidden w-[264px] shrink-0 flex-col rounded-panel p-3 lg:flex">
        <div className="flex items-center gap-1.5">
          <label className="flex h-8 flex-1 items-center gap-2 rounded-control bg-fill px-2.5 text-ink-muted">
            <Search aria-hidden className="size-3.5 shrink-0" />
            <span className="sr-only">{t('search')}</span>
            <input
              type="search"
              placeholder={t('search')}
              className="w-full bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
            />
          </label>
          <Tooltip content={t('newChat')}>
            <Button icon variant="ghost" aria-label={t('newChat')}>
              <SquarePen />
            </Button>
          </Tooltip>
        </div>
        <div className="mt-3 flex flex-col gap-0.5">
          <NavItem icon={<BookOpen aria-hidden />}>{t('library')}</NavItem>
          <NavItem icon={<Gauge aria-hidden />}>{t('quality')}</NavItem>
        </div>
        <nav className="mt-5 flex-1 overflow-hidden" aria-label="Chats">
          <ChatGroup label={t('today')}>
            {CHATS_TODAY.map((id, i) => (
              <ChatItem key={id} active={i === 0}>
                {t(`chats.${id}`)}
              </ChatItem>
            ))}
          </ChatGroup>
          <ChatGroup label={t('thisWeek')}>
            {CHATS_WEEK.map((id) => (
              <ChatItem key={id}>{t(`chats.${id}`)}</ChatItem>
            ))}
          </ChatGroup>
        </nav>
        <div className="flex flex-col gap-0.5">
          <NavItem icon={<Settings aria-hidden />}>{t('settings')}</NavItem>
        </div>
      </aside>

      {/* Chat column */}
      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex flex-col gap-2 px-4 pt-2 pb-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <h2 className="truncate text-title-3 font-semibold">{t('chatTitle')}</h2>
          <div className="flex shrink-0 items-center gap-2">
            <ToolbarButton>
              <FileText aria-hidden className="size-3.5" />
              {t('scope')}
            </ToolbarButton>
            <ToolbarButton>
              {t('model')}
              <ChevronDown aria-hidden className="size-3.5 opacity-60" />
            </ToolbarButton>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 pb-40">
          <div className="mx-auto flex max-w-[720px] flex-col gap-8 pt-6">
            <div className="ml-auto max-w-[80%] rounded-card bg-fill-strong px-4 py-2.5 text-reading">
              {t('question')}
            </div>

            <article className="max-w-[68ch] text-reading">
              <p>
                {t('answerLead')} <strong className="font-semibold">{t('answerIp')}</strong>{' '}
                {t('answerMid')}
                <CitationChip
                  n={1}
                  label={t('citation', { n: 1, source: t('source1') })}
                  active={activeSource === 1}
                  onClick={() => setActiveSource(1)}
                />{' '}
                {t('answerIkLead')} <strong className="font-semibold">{t('answerIk')}</strong>{' '}
                {t('answerTail')}
                <CitationChip
                  n={2}
                  label={t('citation', { n: 2, source: t('source2') })}
                  active={activeSource === 2}
                  onClick={() => setActiveSource(2)}
                />
              </p>

              <div className="mt-5 flex flex-col gap-1.5">
                {([1, 2] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setActiveSource(n)}
                    className={cn(
                      'flex w-fit items-center gap-2.5 rounded-control px-2 py-1 text-footnote text-ink-muted',
                      'transition-colors hover:bg-fill hover:text-ink',
                      activeSource === n && 'bg-fill text-ink',
                    )}
                  >
                    <span className="inline-flex size-[18px] items-center justify-center rounded-full bg-highlight text-[11px] font-semibold text-sodium-ink tabular-nums">
                      {n}
                    </span>
                    {t(n === 1 ? 'source1' : 'source2')}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-caption text-ink-muted">{t('answerMeta')}</p>
            </article>
          </div>
        </div>

        {/* Composer: floating glass */}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 px-4">
          <form
            className="glass pointer-events-auto mx-auto flex max-w-[720px] items-end gap-2 rounded-[22px] p-2"
            onSubmit={(event) => event.preventDefault()}
          >
            <Tooltip content={t('attach')}>
              <Button icon variant="ghost" aria-label={t('attach')}>
                <Paperclip />
              </Button>
            </Tooltip>
            <label className="sr-only" htmlFor="preview-composer">
              {t('composerPlaceholder')}
            </label>
            <textarea
              id="preview-composer"
              rows={1}
              placeholder={t('composerPlaceholder')}
              className="min-h-9 flex-1 resize-none bg-transparent py-1.5 text-reading outline-none placeholder:text-ink-muted"
            />
            <Button icon variant="primary" aria-label={t('send')} type="submit">
              <ArrowUp />
            </Button>
          </form>
        </div>
      </main>

      {/* Document panel: a solid page under a glass header, the passage is "switched on" */}
      {activeSource && highlightedRow && (
        <section
          aria-label={t('docTitle')}
          className="hidden w-[440px] shrink-0 flex-col overflow-hidden rounded-panel bg-surface shadow-float ring-1 ring-hairline xl:flex"
        >
          <header className="glass flex items-center justify-between gap-3 rounded-none border-0 border-b border-hairline px-4 py-3 shadow-none">
            <div className="min-w-0">
              <p className="truncate text-body font-medium">Mira_L_Datenblatt.pdf</p>
              <p className="text-caption text-ink-muted">{t('page')}</p>
            </div>
            <Button icon variant="ghost" size="sm" aria-label={t('closePanel')} onClick={() => setActiveSource(null)}>
              <X />
            </Button>
          </header>
          <div className="flex-1 overflow-y-auto p-8">
            <p className="text-caption text-ink-muted">{t('docSubtitle')}</p>
            <h3 className="mt-1 text-title-2 font-semibold">{t('docTitle')}</h3>
            <dl className="mt-6 divide-y divide-hairline text-footnote">
              {DOC_ROWS.map((row) => (
                <div
                  key={row}
                  className={cn(
                    'grid grid-cols-[1fr_1.2fr] gap-4 rounded-[6px] px-2 py-2.5',
                    row === highlightedRow && 'lamp-on bg-highlight',
                  )}
                >
                  <dt className="text-ink-muted">{t(`rows.${row}.label`)}</dt>
                  <dd className="font-medium">{t(`rows.${row}.value`)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}
    </div>
  );
}

function ChatGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="px-2 pb-1 text-caption font-medium text-ink-muted">{label}</p>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  );
}

function ChatItem({ active = false, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <li>
      <a
        href="#"
        aria-current={active ? 'page' : undefined}
        className={cn(
          'block truncate rounded-control px-2 py-1.5 text-body',
          active ? 'bg-fill-strong font-medium' : 'text-ink/85 hover:bg-fill',
        )}
      >
        <span className="truncate">{children}</span>
      </a>
    </li>
  );
}

function NavItem({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <a
      href="#"
      className="flex items-center gap-2.5 rounded-control px-2 py-1.5 text-body text-ink/85 hover:bg-fill [&_svg]:size-4 [&_svg]:opacity-60"
    >
      {icon}
      {children}
    </a>
  );
}

/** Toolbar control in the macOS style: quiet until hovered. */
function ToolbarButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-footnote font-medium text-ink-muted transition-colors hover:bg-fill hover:text-ink"
    >
      {children}
    </button>
  );
}
