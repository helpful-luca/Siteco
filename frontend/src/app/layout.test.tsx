import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (name in cookieJar ? { value: cookieJar[name] } : undefined) }),
  headers: async () => new Headers({ 'accept-language': 'de-DE,de;q=0.9' }),
}));
vi.mock('next/font/google', () => ({ Inter: () => ({ variable: 'font-inter' }) }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
vi.mock('next-intl', () => ({
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => children,
  useTranslations: () => (key: string) => key,
}));

const { default: RootLayout } = await import('./layout');

async function renderLayout(): Promise<string> {
  return renderToStaticMarkup(await RootLayout({ children: <main>app</main> }));
}

afterEach(() => {
  cookieJar = {};
  vi.unstubAllGlobals();
});

describe('root layout: first HTML without a flash', () => {
  it('has language and dark class from the cookie mirror, no theme script', async () => {
    cookieJar = { locale: 'en', theme: 'dark', name: 'Luca', onboarded: '1' };
    const html = await renderLayout();
    expect(html).toMatch(/<html lang="en" class="font-inter dark"/);
    expect(html).not.toContain('prefers-color-scheme');
  });

  it('adds the inline script before paint for the automatic theme', async () => {
    cookieJar = { locale: 'de', theme: 'system', onboarded: '1' };
    const html = await renderLayout();
    expect(html).toMatch(/<html lang="de" class="font-inter"/);
    expect(html).toContain('prefers-color-scheme');
  });

  it('asks the backend once when the cookies are missing (desktop window, new browser)', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        locale: 'en',
        theme: 'light',
        name: 'Luca',
        default_model: 'claude-sonnet-5-5',
        effort: 'low',
        style: 'concise',
        compare_models: ['claude-sonnet-5-5', 'claude-haiku-4-5'],
        onboarded: true,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const html = await renderLayout();
    expect(html).toMatch(/<html lang="en" class="font-inter"/);
    expect(html).not.toContain('prefers-color-scheme');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/api\/preferences$/);
  });

  it('renders with the browser language when the backend is not there yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    const html = await renderLayout();
    expect(html).toMatch(/<html lang="de" class="font-inter"/);
  });

  it('puts the window drag strip at the start of the body, before any control', async () => {
    cookieJar = { locale: 'de', theme: 'dark', onboarded: '1' };
    const html = await renderLayout();
    expect(html).toMatch(/<body><div aria-hidden="true" class="window-drag-strip"><\/div>/);
  });
});
