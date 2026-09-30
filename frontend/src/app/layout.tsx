import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { QueryProvider } from '@/shared/api/query-provider';
import { DESKTOP_SCRIPT } from '@/shared/desktop/desktop-script';
import { COOKIE_THEME, resolveTheme } from '@/shared/preferences/cookies';
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
  const locale = await getLocale();
  const theme = resolveTheme((await cookies()).get(COOKIE_THEME)?.value);
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
        <NextIntlClientProvider>
          <QueryProvider>{children}</QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
