import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreferencesBody } from '@/shared/api/types';
import { PreferencesMirror, PreferencesProvider, usePreferences, useSavePreferences } from './preferences';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const STORED: PreferencesBody = {
  locale: 'de',
  theme: 'dark',
  name: 'Luca',
  default_model: 'claude-sonnet-5-5',
  effort: 'low',
  style: 'concise',
  compare_models: ['claude-sonnet-5-5', 'claude-haiku-4-5'],
  onboarded: true,
};

let respond: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  refresh.mockReset();
  document.documentElement.lang = 'de';
  document.documentElement.className = '';
  respond = async () => Response.json(STORED);
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => respond(url, init)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ['name', 'onboarded', 'theme', 'locale']) document.cookie = `${name}=; max-age=0; path=/`;
});

function Greeting() {
  const { name } = usePreferences();
  return <p>Hallo {name}</p>;
}

type Save = ReturnType<typeof useSavePreferences>;

function setup(name = 'Luca'): Save {
  const saver: { current: Save | null } = { current: null };
  function Saver() {
    const save = useSavePreferences();
    useEffect(() => {
      saver.current = save;
    }, [save]);
    return null;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PreferencesProvider initial={{ locale: 'de', theme: 'dark', name, onboarded: true, mirrored: true }}>
        <PreferencesMirror />
        <Greeting />
        <Saver />
      </PreferencesProvider>
    </QueryClientProvider>,
  );
  return (patch) => (saver.current as Save)(patch);
}

describe('preferences', () => {
  it('renders the server values before the backend answered (no flash)', () => {
    respond = () => new Promise(() => {});
    setup();
    expect(screen.getByText('Hallo Luca')).toBeInTheDocument();
  });

  it('mirrors the backend into cookies and applies the theme', async () => {
    respond = async () => Response.json({ ...STORED, name: 'Zoë' });
    setup();
    expect(await screen.findByText('Hallo Zoë')).toBeInTheDocument();
    await waitFor(() => expect(document.cookie).toContain(`name=${encodeURIComponent('Zoë')}`));
    expect(document.cookie).toContain('onboarded=1');
    expect(document.cookie).toContain('theme=dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('switches the language: PUT, cookie, router refresh', async () => {
    const save = setup();
    await screen.findByText('Hallo Luca');
    respond = async (_url, init) => Response.json(JSON.parse(String(init?.body)));
    await act(() => save({ locale: 'en' }));
    const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({ ...STORED, locale: 'en' });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(document.cookie).toContain('locale=en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('rolls back a change the backend refuses', async () => {
    const save = setup();
    await screen.findByText('Hallo Luca');
    respond = async () =>
      Response.json({ error: { code: 'VALIDATION_ERROR', retryable: false, request_id: 'r', params: {} } }, { status: 422 });
    await act(async () => {
      await expect(save({ name: 'x' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
    expect(screen.getByText('Hallo Luca')).toBeInTheDocument();
  });

  it('leaves language and theme alone before the setup ran', async () => {
    respond = async () => Response.json({ ...STORED, onboarded: false, locale: 'en', theme: 'light' });
    setup('');
    await waitFor(() => expect(document.cookie).toContain('onboarded=0'));
    expect(document.cookie).not.toContain('theme=');
    expect(document.documentElement.lang).toBe('de');
  });
});
