import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreferencesBody } from '@/shared/api/types';
import type { InitialPreferences } from '@/shared/preferences/initial';
import { PreferencesProvider } from '@/shared/preferences/preferences';
import de from '../../../messages/de.json';
import { OnboardingHost, useOnboarding } from './onboarding-host';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }) }));

const STORED: PreferencesBody = {
  locale: 'de',
  theme: 'system',
  name: '',
  default_model: 'claude-sonnet-5-5',
  effort: 'low',
  style: 'concise',
  compare_models: ['claude-sonnet-5-5', 'claude-haiku-4-5'],
  onboarded: false,
};

let stored: PreferencesBody;
let puts: PreferencesBody[];

beforeEach(() => {
  stored = { ...STORED };
  puts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        stored = JSON.parse(String(init.body)) as PreferencesBody;
        puts.push(stored);
      }
      return Response.json(stored);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'onboarded=; max-age=0; path=/';
  document.cookie = 'theme=; max-age=0; path=/';
  document.cookie = 'locale=; max-age=0; path=/';
});

function RerunButton() {
  const { open } = useOnboarding();
  return (
    <button type="button" onClick={open}>
      rerun
    </button>
  );
}

function setup(initial: Partial<InitialPreferences> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <QueryClientProvider client={client}>
        <PreferencesProvider
          initial={{ locale: 'de', theme: 'system', name: '', onboarded: false, mirrored: true, ...initial }}
        >
          <OnboardingHost>
            <p>App</p>
            <RerunButton />
          </OnboardingHost>
        </PreferencesProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe('OnboardingHost', () => {
  it('opens over the app on the first start', async () => {
    setup();
    expect(await screen.findByRole('heading', { name: 'Willkommen' })).toBeInTheDocument();
    expect(screen.getByText('App')).toBeInTheDocument();
  });

  it('stays closed once the setup ran', async () => {
    stored = { ...STORED, onboarded: true };
    setup({ onboarded: true });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Willkommen' })).not.toBeInTheDocument();
  });

  it('saves onboarded when skipped, with the language chosen so far', async () => {
    setup();
    await userEvent.click(await screen.findByRole('radio', { name: /English/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Überspringen' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ onboarded: true, locale: 'en', name: '' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Willkommen' })).not.toBeInTheDocument());
  });

  it('counts Escape as skipping', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Willkommen' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(puts[0]).toMatchObject({ onboarded: true }));
  });

  it('saves the name and choices when finished', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Weiter' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Dunkel/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    await userEvent.type(await screen.findByLabelText('Dein Name'), 'Luca{Enter}');
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ onboarded: true, theme: 'dark', name: 'Luca', locale: 'de' });
  });

  it('runs again on request from the settings', async () => {
    stored = { ...STORED, onboarded: true, name: 'Luca' };
    setup({ onboarded: true, name: 'Luca' });
    await userEvent.click(screen.getByRole('button', { name: 'rerun' }));
    expect(await screen.findByRole('heading', { name: 'Willkommen' })).toBeInTheDocument();
  });
});
