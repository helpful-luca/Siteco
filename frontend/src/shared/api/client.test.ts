import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJson } from './client';
import { connection } from './connection';

afterEach(() => {
  vi.unstubAllGlobals();
  connection.reset();
});

describe('fetchJson', () => {
  it('sends the app header and parses JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchJson('/api/config')).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'X-Requested-With': 'docchat' });
  });

  it('accepts 204 without a body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(fetchJson('/api/documents/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

describe('fetchJson and the connection', () => {
  it('reports a network failure as NETWORK_ERROR and marks the backend down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchJson('/api/chats')).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
    expect(connection.getState()).toBe('down');
  });

  it('marks the backend down when the proxy cannot reach it, and up with the next answer', async () => {
    const unavailable = Response.json(
      { error: { code: 'BACKEND_UNAVAILABLE', retryable: true, request_id: 'req_1', params: {} } },
      { status: 503 },
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(unavailable).mockResolvedValueOnce(Response.json({})));
    await expect(fetchJson('/api/chats')).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' });
    expect(connection.getState()).toBe('down');
    await fetchJson('/api/health/live');
    expect(connection.getState()).toBe('up');
  });

  it('an error answer from the backend itself means it is reachable', async () => {
    connection.reportDown();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: { code: 'CHAT_NOT_FOUND', params: {} } }, { status: 404 })),
    );
    await expect(fetchJson('/api/chats/x')).rejects.toMatchObject({ code: 'CHAT_NOT_FOUND' });
    expect(connection.getState()).toBe('up');
  });

  it('passes our own abort through untouched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    await expect(fetchJson('/api/chats')).rejects.toMatchObject({ name: 'AbortError' });
    expect(connection.getState()).toBe('up');
  });
});
