import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJson } from './client';

afterEach(() => vi.unstubAllGlobals());

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
