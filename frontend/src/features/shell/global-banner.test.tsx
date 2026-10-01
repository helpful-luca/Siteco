import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountStatus } from '@/shared/api/account-status';
import { connection } from '@/shared/api/connection';
import type { ConfigOut } from '@/shared/api/types';
import de from '../../../messages/de.json';
import { ConnectionWatcher } from './connection-watcher';
import { GlobalBanner } from './global-banner';

function config(patch: Partial<ConfigOut> = {}): ConfigOut {
  return {
    version: 'test',
    commit: 'x',
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
    models: [],
    default_model: 'claude-sonnet-5-5',
    ...patch,
  };
}

function setup(cfg: ConfigOut = config()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['config'], cfg);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Berlin">
      <QueryClientProvider client={client}>
        <GlobalBanner />
        <ConnectionWatcher />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return { invalidate };
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ app: 'x', status: 'ok' }))));
afterEach(() => {
  cleanup(); // unmount first, so no watcher reacts to the resets below
  vi.unstubAllGlobals();
  vi.useRealTimers();
  connection.reset();
  accountStatus.reportAnswerWentThrough();
  setOnline(true);
});

describe('GlobalBanner', () => {
  it('shows nothing when all is well', () => {
    setup();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('explains a missing key as a quiet note', () => {
    setup(config({ llm_status: 'missing_key' }));
    expect(screen.getByRole('note')).toHaveTextContent(de.banner.missingKey);
  });

  it('tells how to fix a key that was rejected at runtime', () => {
    setup(config({ llm_status: 'invalid_key' }));
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(de.banner.invalidKey);
    // The button says where to go; no second line repeats it.
    expect(screen.getByRole('link', { name: 'API-Key eintragen' })).toHaveAttribute('href', '/settings?section=models');
    expect(banner.querySelectorAll('p')).toHaveLength(1);
  });

  it('asks for the workspace id when the key needs one', () => {
    setup(config({ llm_status: 'needs_workspace' }));
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(de.banner.needsWorkspace);
    expect(screen.getByRole('link', { name: 'Workspace-ID eintragen' })).toHaveAttribute(
      'href',
      '/settings?section=models',
    );
  });

  it('names the local time when the daily budget resets', () => {
    const reset = new Date(2026, 9, 1, 2, 0);
    setup(config({ budget: { limit_usd: 5, spent_usd: 5.1, exceeded: true, reset_time: reset.toISOString() } }));
    expect(screen.getByRole('status')).toHaveTextContent('Ab 02:00 Uhr kannst du wieder fragen.');
  });

  it('shows a billing problem an answer revealed, until an answer goes through', () => {
    setup();
    act(() => accountStatus.reportBillingBlocked());
    expect(screen.getByRole('status')).toHaveTextContent(de.banner.billing);
    act(() => accountStatus.reportAnswerWentThrough());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says so when the browser goes offline', () => {
    setup();
    act(() => setOnline(false));
    expect(screen.getByRole('status')).toHaveTextContent(de.banner.offline);
  });

  it('puts the lost backend first', () => {
    setup(config({ llm_status: 'invalid_key' }));
    act(() => connection.reportDown());
    expect(screen.getByRole('status')).toHaveTextContent(de.banner.reconnecting);
    expect(screen.getByRole('button', { name: de.banner.retryNow })).toBeInTheDocument();
  });
});

describe('ConnectionWatcher', () => {
  it('checks with a growing pause and refetches everything once the backend is back', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(Response.json({ app: 'x', status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const checks = () => fetchMock.mock.calls.filter(([url]) => url === '/api/health/live').length;
    const { invalidate } = setup();
    act(() => connection.reportDown());
    expect(screen.getByRole('status')).toHaveTextContent(de.banner.reconnecting);

    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(checks()).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(1)); // first check after 1 s fails
    expect(checks()).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(1999));
    expect(checks()).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(1)); // second check after 2 more s
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(checks()).toBe(2);

    expect(connection.getState()).toBe('up');
    expect(screen.queryByRole('status')).toBeNull();
    expect(invalidate).toHaveBeenCalledWith();
    expect(screen.getByText(de.banner.reconnected)).toBeInTheDocument();
  });

  it('refetches after an outage that was already there when it mounted', async () => {
    connection.reportDown();
    const { invalidate } = setup();
    await act(async () => connection.reportUp());
    expect(invalidate).toHaveBeenCalledWith();
  });

  it('notices an outage with a quiet heartbeat while nothing else loads', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    setup();
    await act(async () => vi.advanceTimersByTimeAsync(9_999));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/health/live', expect.anything());
    expect(screen.getByRole('status')).toHaveTextContent(de.banner.reconnecting);
  });

  it('checks a suspicion within a second without showing a banner', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ app: 'x', status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const { invalidate } = setup();
    act(() => connection.suspect());
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(connection.getState()).toBe('up');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('never checks faster than once a second, even when a check changes nothing', async () => {
    vi.useFakeTimers();
    // An aborted check reports nothing, so the state stays `unsure`.
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    vi.stubGlobal('fetch', fetchMock);
    setup();
    act(() => connection.suspect());
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
    expect(connection.getState()).toBe('unsure');
  });
});

describe('GlobalBanner accessibility', () => {
  it('names the lost backend once: the spinner is decoration', () => {
    setup();
    act(() => connection.reportDown());
    const banner = screen.getByRole('status');
    expect(banner.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(banner.querySelector('[role="img"]')).toBeNull();
  });
});
