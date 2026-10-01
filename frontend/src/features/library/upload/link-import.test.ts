import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/errors';
import { doc } from '../testing';
import { importLink } from './link-import';

function job(patch: Record<string, unknown>) {
  return {
    job: {
      id: 'j1',
      url: 'https://www.siteco.de/k.pdf',
      state: 'downloading',
      received_bytes: 0,
      total_bytes: null,
      document: null,
      error_code: null,
      error_params: {},
      retryable: false,
      ...patch,
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('importLink', () => {
  it('starts the job and follows its progress until the document is there', async () => {
    const answers = [
      job({}),
      job({ received_bytes: 400, total_bytes: 1000 }),
      job({ state: 'done', received_bytes: 1000, total_bytes: 1000, document: doc({ id: 'n1' }) }),
    ];
    const fetchMock = vi.fn(async () => Response.json(answers.shift()));
    vi.stubGlobal('fetch', fetchMock);
    const progress = vi.fn();
    const document = await importLink('https://www.siteco.de/k.pdf', { chatId: 'c1', onProgress: progress, pollMs: 1 });
    expect(document.id).toBe('n1');
    expect(progress).toHaveBeenLastCalledWith(400, 1000);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/documents/import-url');
    expect(JSON.parse(String(init.body))).toEqual({ url: 'https://www.siteco.de/k.pdf', library: false, chat_id: 'c1' });
  });

  it('turns a failed job into the error with its params', async () => {
    const answers = [job({}), job({ state: 'failed', error_code: 'URL_TOO_LARGE', error_params: { max_mb: 1024 } })];
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(answers.shift())));
    const failure = importLink('https://x.example/a.pdf', { chatId: null, onProgress: vi.fn(), pollMs: 1 });
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ code: 'URL_TOO_LARGE', params: { max_mb: 1024 } });
  });

  it('cancels the download on the server when aborted', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(job({})),
    );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    const running = importLink('https://x.example/a.pdf', { chatId: null, onProgress: vi.fn(), signal: controller.signal, pollMs: 50 });
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledWith('/api/documents/imports/j1', expect.objectContaining({ method: 'DELETE' }));
  });
});
