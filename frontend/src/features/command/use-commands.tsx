'use client';

import { BookOpen, FileText, MessageSquare, Monitor, Moon, PanelLeft, RotateCcw, Settings, SquarePen, Sun, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { formatListTime, useChats } from '@/features/chat';
import { useDocuments, useUploads } from '@/features/library';
import { useOnboarding } from '@/features/onboarding';
import { SECTIONS, sectionHref } from '@/features/settings';
import { useUI } from '@/features/shell';
import { useOpenDocument } from '@/features/viewer';
import { useMediaQuery } from '@/shared/lib/use-media-query';
import { applyTheme } from '@/shared/preferences/apply-theme';
import type { Theme } from '@/shared/preferences/cookies';
import { useSavePreferences } from '@/shared/preferences/preferences';
import type { Command } from './rank';

/** Everything the palette can find: chats, library documents, actions and settings sections. */
export function useCommands(close: () => void): Command[] {
  const t = useTranslations('command');
  const tChat = useTranslations('chat');
  const tSettings = useTranslations('settings.sections');
  const router = useRouter();
  const { data: chats } = useChats();
  const { data: documents } = useDocuments();
  const uploads = useUploads();
  const onboarding = useOnboarding();
  const openDocument = useOpenDocument();
  const save = useSavePreferences();
  const { sidebarCollapsed, setSidebarCollapsed, setSidebarOpen } = useUI();
  const wide = useMediaQuery('(min-width: 1024px)');
  const locale = useLocale();

  return useMemo(() => {
    // Every command closes the palette first, so focus and the URL settle in the right order.
    const run = (action: () => void) => () => {
      close();
      action();
    };
    const go = (href: string) => run(() => router.push(href));
    const theme = (value: Theme) =>
      run(() => {
        applyTheme(value);
        save({ theme: value }).catch(() => undefined);
      });

    const sortedChats = [...(chats?.chats ?? [])].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    const chatCommands = sortedChats.flatMap((chat): Command[] => {
      const base = {
        title: chat.title ?? tChat('untitled'),
        hint: formatListTime(chat.updated_at, new Date(), locale),
        icon: <MessageSquare aria-hidden />,
        run: go(`/chat/${chat.id}`),
      };
      return [
        { ...base, id: `chat:${chat.id}`, group: 'chats' },
        { ...base, id: `recent:${chat.id}`, group: 'recent' },
      ];
    });

    const documentCommands = (documents?.documents ?? []).map(
      (document): Command => ({
        id: `doc:${document.id}`,
        group: 'documents',
        title: document.filename,
        hint: document.page_count ? t('pages', { count: document.page_count }) : undefined,
        icon: <FileText aria-hidden />,
        run: run(() => (document.status === 'ready' ? openDocument(document) : router.push('/library'))),
      }),
    );

    const actions: Command[] = [
      { id: 'new-chat', group: 'actions', title: t('actions.newChat'), icon: <SquarePen aria-hidden />, run: go('/chat') },
      {
        id: 'upload',
        group: 'actions',
        title: t('actions.upload'),
        keywords: t('keywords.upload'),
        icon: <Upload aria-hidden />,
        run: run(() => uploads.openPicker()),
      },
      { id: 'library', group: 'actions', title: t('actions.library'), icon: <BookOpen aria-hidden />, run: go('/library') },
      {
        id: 'sidebar',
        group: 'actions',
        title: t('actions.toggleSidebar'),
        keywords: t('keywords.sidebar'),
        icon: <PanelLeft aria-hidden />,
        run: run(() => (wide ? setSidebarCollapsed(!sidebarCollapsed) : setSidebarOpen(true))),
      },
      { id: 'light', group: 'actions', title: t('actions.themeLight'), keywords: t('keywords.theme'), icon: <Sun aria-hidden />, run: theme('light') },
      { id: 'dark', group: 'actions', title: t('actions.themeDark'), keywords: t('keywords.theme'), icon: <Moon aria-hidden />, run: theme('dark') },
      {
        id: 'system',
        group: 'actions',
        title: t('actions.themeSystem'),
        keywords: t('keywords.theme'),
        icon: <Monitor aria-hidden />,
        run: theme('system'),
      },
      { id: 'setup', group: 'actions', title: t('actions.setup'), icon: <RotateCcw aria-hidden />, run: run(onboarding.open) },
    ];

    const settings = SECTIONS.map(
      (section): Command => ({
        id: `settings:${section}`,
        group: 'settings',
        title: t('openSettings', { section: tSettings(section) }),
        keywords: t('keywords.settings'),
        icon: <Settings aria-hidden />,
        run: go(sectionHref(section)),
      }),
    );

    return [...chatCommands, ...documentCommands, ...actions, ...settings];
  }, [
    chats,
    documents,
    close,
    router,
    save,
    t,
    tChat,
    tSettings,
    locale,
    openDocument,
    uploads,
    onboarding,
    wide,
    sidebarCollapsed,
    setSidebarCollapsed,
    setSidebarOpen,
  ]);
}
