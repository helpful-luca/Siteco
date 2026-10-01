import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { WindowControls, WindowDragStrip } from '@/features/shell';
import { QueryProvider } from '@/shared/api/query-provider';
import { DESKTOP_SCRIPT } from '@/shared/desktop/desktop-script';
import { PreferencesProvider } from '@/shared/preferences/preferences';
import { getInitialPreferences } from '@/shared/preferences/server';
import { THEME_SCRIPT } from '@/shared/preferences/theme-script';
import './globals.css';

// next/font downloads Inter at build time and serves it from our own origin:
// the browser never contacts Google (GDPR).
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  return { title: t('name'), description: t('description') };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Language, theme, name and setup state are in the first HTML: no flash.
  const preferences = await getInitialPreferences();
  const { locale, theme } = preferences;
  return (
    <html
      lang={locale}
      className={theme === 'dark' ? `${inter.variable} dark` : inter.variable}
      suppressHydrationWarning
    >
      <head>
        {theme === 'system' && <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />}
        <script dangerouslySetInnerHTML={{ __html: DESKTOP_SCRIPT }} />
      </head>
      <body>
        {/* First in the document: controls that follow are cut out of its drag area. */}
        <WindowDragStrip />
        <NextIntlClientProvider>
          <QueryProvider>
            <PreferencesProvider initial={preferences}>{children}</PreferencesProvider>
          </QueryProvider>
          <WindowControls />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
