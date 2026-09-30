'use client';

import { COOKIE_LOCALE } from '@/shared/preferences/cookies';

// Replaces the root layout: no providers, no i18n, no global styles. It keeps the app's look
// with a few inline rules (system font, canvas colors, a pill button) and follows the OS theme.
const TEXT = {
  de: {
    title: 'Die App lässt sich gerade nicht anzeigen.',
    text: 'Deine Dokumente und Chats sind sicher. Versuch es noch einmal.',
    retry: 'Erneut versuchen',
    id: 'Fehler-ID',
  },
  en: {
    title: "The app can't be shown right now.",
    text: 'Your documents and chats are safe. Please try again.',
    retry: 'Try again',
    id: 'Error ID',
  },
} as const;

const STYLE = `
  :root { color-scheme: light dark; --canvas: #f2f2f5; --ink: #1d1d1f; --muted: #6e6e73; --accent: #f0a030; }
  @media (prefers-color-scheme: dark) { :root { --canvas: #000; --ink: #f5f5f7; --muted: #98989d; --accent: #ffb547; } }
  html, body { margin: 0; background: var(--canvas); color: var(--ink); overscroll-behavior: none;
    font: 15px/1.47 -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; }
  main { min-height: 100dvh; display: grid; place-items: center; padding: 0 16px; }
  div { max-width: 60ch; }
  h1 { font-size: 22px; line-height: 28px; font-weight: 600; margin: 0; }
  p { margin: 8px 0 0; color: var(--muted); }
  button { margin-top: 24px; height: 32px; padding: 0 16px; border: 0; border-radius: 999px; cursor: pointer;
    background: var(--accent); color: #1d1d1f; font: inherit; font-weight: 500; }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  small { display: block; margin-top: 16px; color: var(--muted); font-size: 12px; }
`;

function locale(): keyof typeof TEXT {
  if (typeof document === 'undefined') return 'de';
  const cookie = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE_LOCALE}=`));
  const value = cookie?.split('=')[1] ?? navigator.language;
  return value.startsWith('en') ? 'en' : 'de';
}

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const lang = locale();
  const t = TEXT[lang];
  return (
    <html lang={lang}>
      <body>
        <style>{STYLE}</style>
        <main role="alert">
          <div>
            <h1>{t.title}</h1>
            <p>{t.text}</p>
            <button type="button" onClick={retry}>
              {t.retry}
            </button>
            {error.digest && (
              <small>
                {t.id} {error.digest}
              </small>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
