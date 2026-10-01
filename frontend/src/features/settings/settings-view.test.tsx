import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingHost } from '@/features/onboarding';
import { UIProvider } from '@/features/shell';
import type { ConfigOut, PreferencesBody, WorkspaceOut } from '@/shared/api/types';
import { PreferencesProvider } from '@/shared/preferences/preferences';
import de from '../../../messages/de.json';
import { SettingsView } from './settings-view';
import type { Section } from './sections';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/settings',
}));

const MODEL: Pick<ConfigOut['models'][number], 'cache_read_usd_per_mtok' | 'efforts' | 'default_effort' | 'available'> =
  {
    cache_read_usd_per_mtok: 0.2,
    efforts: ['low', 'medium', 'high'],
    default_effort: 'low',
    available: true,
  };

const CONFIG: ConfigOut = {
  version: '1.0.0',
  commit: 'abc123def4567890',
  llm_status: 'ok',
  limits: {
    max_upload_mb: 1024,
    max_pdf_pages: 5000,
    max_storage_mb: 20480,
    max_question_chars: 4000,
    chat_per_minute: 20,
    uploads_per_minute: 30,
    max_concurrent_answers: 3,
    daily_budget_usd: null,
  },
  budget: null,
  features: { retrieval_only: false },
  models: [
    {
      ...MODEL,
      id: 'claude-haiku-4-5',
      label: 'Claude Haiku 4.5',
      tier: 'fast',
      input_usd_per_mtok: 1,
      output_usd_per_mtok: 5,
      efforts: [],
      default_effort: null,
    },
    {
      ...MODEL,
      id: 'claude-sonnet-5-5',
      label: 'Claude Sonnet 5.5',
      tier: 'balanced',
      input_usd_per_mtok: 2,
      output_usd_per_mtok: 10,
    },
    {
      ...MODEL,
      id: 'claude-opus-5-5',
      label: 'Claude Opus 5.5',
      tier: 'strongest',
      input_usd_per_mtok: 4,
      output_usd_per_mtok: 20,
    },
  ],
  default_model: 'claude-sonnet-5-5',
};

const PREFS: PreferencesBody = {
  locale: 'de',
  theme: 'system',
  name: 'Lena',
  default_model: 'claude-sonnet-5-5',
  effort: 'low',
  style: 'concise',
  compare_models: ['claude-sonnet-5-5', 'claude-haiku-4-5'],
  onboarded: true,
  retention_days: 30,
};

const WORKSPACE: WorkspaceOut = {
  stats: {
    documents: 3,
    chats: 2,
    documents_bytes: 2_400_000,
    storage_bytes: 5_300_000,
  },
  usage_today: {
    cost_usd: 0.0123,
    requests: 4,
    input_tokens: 9000,
    output_tokens: 800,
    budget_usd: null,
  },
  usage_month: { cost_usd: 1.5, requests: 120 },
  retention_days: 30,
};

let prefs: PreferencesBody;
let calls: { method: string; url: string; body?: unknown }[];
let llmStatus: ConfigOut['llm_status'] = 'ok';

beforeEach(() => {
  prefs = { ...PREFS };
  calls = [];
  llmStatus = 'ok';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({
        method,
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url === '/api/config') return Response.json({ ...CONFIG, llm_status: llmStatus });
      if (url === '/api/preferences' && method === 'PUT') {
        prefs = JSON.parse(String(init?.body)) as PreferencesBody;
        return Response.json(prefs);
      }
      if (url === '/api/preferences') return Response.json(prefs);
      if (url === '/api/workspace') return Response.json(WORKSPACE);
      if (url === '/api/settings/api-key' && method === 'PUT') {
        const { key, workspace_id } = JSON.parse(String(init?.body)) as { key: string; workspace_id?: string | null };
        if (key.endsWith('Wrks') && !workspace_id) {
          return Response.json(
            { error: { code: 'LLM_KEY_NEEDS_WORKSPACE', retryable: false, request_id: 'r', params: {} } },
            { status: 422 },
          );
        }
        if (key.endsWith('Bad1')) {
          return Response.json(
            {
              error: {
                code: 'API_KEY_INVALID',
                retryable: false,
                request_id: 'r',
                params: {},
              },
            },
            { status: 422 },
          );
        }
        return Response.json({
          configured: true,
          source: 'settings',
          suffix: key.slice(-4),
          status: 'ok',
          workspace_id: workspace_id ?? null,
        });
      }
      if (url === '/api/settings/api-key') {
        return Response.json({
          configured: false,
          source: null,
          suffix: null,
          status: 'missing_key',
          workspace_id: null,
        });
      }
      if (url.startsWith('/api/workspace') && method === 'DELETE') return new Response(null, { status: 204 });
      if (url === '/api/health/ready') return Response.json({ ready: true, checks: {} });
      return Response.json({}, { status: 404 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function setup(section: Section | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Berlin">
      <QueryClientProvider client={client}>
        <PreferencesProvider
          initial={{
            locale: 'de',
            theme: 'system',
            name: 'Lena',
            onboarded: true,
            mirrored: true,
          }}
        >
          <OnboardingHost>
            <UIProvider>
              <SettingsView section={section} />
            </UIProvider>
          </OnboardingHost>
        </PreferencesProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe('SettingsView', () => {
  it('lists every section with its own address', () => {
    setup(null);
    const nav = screen.getByRole('navigation', { name: 'Bereiche' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Allgemein', 'Darstellung', 'Modelle', 'Tastenkürzel', 'Daten', 'Datenschutz']);
    expect(links[3]).toHaveAttribute('href', '/settings?section=shortcuts');
  });

  it('marks the open section and offers a way back on narrow screens', () => {
    setup('models');
    expect(screen.getByRole('link', { name: 'Modelle' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 2, name: 'Modelle' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Einstellungen' })).toHaveAttribute('href', '/settings');
  });

  it('switches the language through the backend', async () => {
    setup('general');
    await userEvent.click(screen.getByRole('radio', { name: 'English' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      ...PREFS,
      locale: 'en',
    });
  });

  it('saves a cleaned name when the field is left', async () => {
    setup('general');
    const field = await screen.findByLabelText('Dein Name');
    await waitFor(() => expect(field).toHaveValue('Lena'));
    await userEvent.clear(field);
    await userEvent.type(field, '  Anna  {Enter}');
    await waitFor(() => expect(prefs.name).toBe('Anna'));
    expect(await screen.findByText('Gespeichert')).toBeInTheDocument();
  });

  it('shows prices and hides the answer mode for Haiku', async () => {
    setup('models');
    expect(await screen.findByRole('radio', { name: /Claude Opus 5.5/ })).toHaveTextContent(
      '4 $ Eingabe, 20 $ Ausgabe',
    );
    expect(screen.getByRole('radiogroup', { name: 'Antwortmodus' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Claude Haiku 4.5/ }));
    await waitFor(() => expect(prefs.default_model).toBe('claude-haiku-4-5'));
    expect(screen.queryByRole('radiogroup', { name: 'Antwortmodus' })).toBeNull();
    expect(screen.getByText(/antwortet immer schnell/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Ausführlich' }));
    await waitFor(() => expect(prefs.style).toBe('detailed'));
  });

  it('shows storage and retention, and deletes everything after a clear confirmation', async () => {
    setup('data');
    expect(await screen.findByText('Belegt auf diesem Rechner')).toBeInTheDocument();
    // Spending lives in Models; Data shows today's cost only next to a daily budget.
    expect(screen.queryByText('4 Anfragen an Claude')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Löschen …' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Alle Daten löschen?',
    });
    expect(dialog).toHaveTextContent('Das entfernt 3 Dokumente und 2 Chats samt allen Suchdaten');
    expect(dialog).toHaveTextContent('nicht rückgängig');
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    await userEvent.click(
      within(dialog).getByRole('switch', {
        name: 'Auch Name und Einstellungen zurücksetzen',
      }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Alles löschen' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/workspace?reset_preferences=true');
    expect(await screen.findByText('Alle Daten wurden gelöscht.')).toBeInTheDocument();
  });

  it('checks and saves an API key without ever showing it, and shows the spending', async () => {
    setup('models');
    await screen.findByLabelText('API-Key');
    const field = screen.getByLabelText('API-Key');
    expect(field).toHaveAttribute('type', 'password');
    await userEvent.type(field, 'sk-ant-api03-xxxxxxxxxxxxxxxxxxxxBad1');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText(/Anthropic akzeptiert diesen API-Key nicht/)).toBeInTheDocument();
    await userEvent.clear(field);
    await userEvent.type(field, 'sk-ant-api03-xxxxxxxxxxxxxxxxxxxxGood');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText(/Gespeichert/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Entfernen' })).toBeInTheDocument();
    expect(screen.getByText('Der API-Key wird lokal auf diesem Rechner gespeichert.')).toBeInTheDocument();
    expect(field).toHaveValue('');
    expect(screen.getByText('120 Anfragen')).toBeInTheDocument();
    expect(screen.queryByText(/Console|Restguthaben/)).not.toBeInTheDocument();
  });

  it('names a missing key with the same banner and button on every section', async () => {
    llmStatus = 'missing_key';
    setup('general');
    expect(await screen.findByText(de.banner.missingKey)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: de.banner.keySettings })).toBeInTheDocument();
    cleanup();
    setup('models');
    await screen.findByLabelText('API-Key');
    expect(await screen.findByText(de.banner.missingKey)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: de.banner.keySettings })).toBeInTheDocument();
  });

  it('asks for the workspace id when Anthropic needs one, and sends it with the key', async () => {
    setup('models');
    const key = await screen.findByLabelText('API-Key');
    const workspace = screen.getByLabelText('Workspace-ID');
    expect(screen.getByText('Nur nötig, wenn Anthropic danach fragt.')).toBeInTheDocument();
    await userEvent.type(key, 'sk-ant-api03-xxxxxxxxxxxxxxxxxxxxWrks');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText(/gehört zu keinem Workspace/)).toBeInTheDocument();
    expect(workspace).toHaveFocus();
    await userEvent.type(workspace, 'wrkspc_01ABC');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText(/Gespeichert/)).toBeInTheDocument();
    const puts = calls.filter((c) => c.url === '/api/settings/api-key' && c.method === 'PUT');
    expect(puts.at(-1)?.body).toEqual({ key: 'sk-ant-api03-xxxxxxxxxxxxxxxxxxxxWrks', workspace_id: 'wrkspc_01ABC' });
    expect(workspace).toHaveValue('wrkspc_01ABC');
  });

  it('chooses automatic deletion in the app, without any word about .env', async () => {
    setup('data');
    const choice = await screen.findByRole('radiogroup', {
      name: 'Automatisch löschen',
    });
    await waitFor(() => expect(within(choice).getByRole('radio', { name: '30 Tage' })).toBeChecked());
    await userEvent.click(within(choice).getByRole('radio', { name: '90 Tage' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      ...PREFS,
      retention_days: 90,
    });
    expect(screen.queryByText(/RETENTION_DAYS|\.env/)).not.toBeInTheDocument();
  });

  it('explains privacy in plain words, with the scan status', async () => {
    setup('privacy');
    expect(screen.getByText('Geht an Anthropic')).toBeInTheDocument();
    expect(screen.getByText(/Dein Name und die Dateien selbst werden nie gesendet/)).toBeInTheDocument();
    expect(await screen.findByText(/Virenprüfung laufen lokal/)).toBeInTheDocument();
    expect(screen.getByText(/bis zu 30 Tage/)).toBeInTheDocument();
    expect(screen.getByText(/keine Nutzungsdaten/)).toBeInTheDocument();
    // Two groups, no single-line groups that repeat each other.
    expect(screen.queryByText('Bei Anthropic')).not.toBeInTheDocument();
    expect(screen.queryByText('Virenprüfung')).not.toBeInTheDocument();
    expect(screen.queryByText('Deine Rechte')).not.toBeInTheDocument();
  });

  it('lists the keyboard shortcuts with Windows keys', () => {
    setup('shortcuts');
    expect(screen.getByRole('heading', { name: 'Tastenkürzel' })).toBeInTheDocument();
    expect(screen.getByText('Befehlspalette öffnen')).toBeInTheDocument();
    expect(screen.getByText('Frage senden')).toBeInTheDocument();
    expect(screen.getByText('Umbenennen')).toBeInTheDocument();
    expect(screen.getAllByText('Ctrl').length).toBeGreaterThan(0);
    expect(screen.queryByText('⌘')).toBeNull();
  });

  it('shows Mac symbols on a Mac', () => {
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    setup('shortcuts');
    expect(screen.getAllByText('⌘').length).toBeGreaterThan(0);
    expect(screen.queryByText('Ctrl')).toBeNull();
    platform.mockRestore();
  });
});
