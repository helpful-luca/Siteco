import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DONE, META } from '../testing';
import { runKey } from './stream-reducer';
import { StreamProvider, useStreams } from './stream-provider';

const SSE = { 'content-type': 'text/event-stream' };
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

type Api = ReturnType<typeof useStreams>;

function setup(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(fetchImpl);
  vi.stubGlobal('fetch', fetchMock);
  const api: { current: Api | null } = { current: null };
  function Probe() {
    api.current = useStreams();
    return null;
  }
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <StreamProvider>
        <Probe />
      </StreamProvider>
    </QueryClientProvider>,
  );
  return { api: () => api.current as Api, fetchMock, invalidate };
}

afterEach(() => vi.unstubAllGlobals());

describe('StreamProvider', () => {
  it('confirms at meta, collects deltas per frame and refreshes the chat when done', async () => {
    const body = [frame('meta', META), ...['Die ', 'Mira ', 'hat ', 'IP66.'].map((text) => frame('delta', { text })), frame('done', DONE)];
    const { api, fetchMock, invalidate } = setup(async () => new Response(body.join(''), { headers: SSE }));
    let confirmed = false;
    await act(async () => {
      confirmed = await api().ask({ chatId: 'c1', question: 'Schutzart?', model: 'claude-sonnet-5-5', locale: 'de' });
    });
    expect(confirmed).toBe(true);
    await waitFor(() => expect(api().runs[runKey('c1')].outcome?.kind).toBe('done'));
    const run = api().runs[runKey('c1')];
    expect(run.text).toBe('Die Mira hat IP66.');
    expect(run.question).toBe('Schutzart?');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/chats/c1/messages');
    expect(JSON.parse(String(init?.body))).toMatchObject({ content: 'Schutzart?', model: 'claude-sonnet-5-5', locale: 'de' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['messages', 'c1'] });
  });

  it('rejects a refusal before the stream and leaves no run behind', async () => {
    const { api } = setup(async () =>
      Response.json({ error: { code: 'NO_DOCUMENTS', retryable: false, request_id: 'r', params: {} } }, { status: 409 }),
    );
    await expect(api().ask({ chatId: 'c1', question: 'x', model: 'm', locale: 'de' })).rejects.toMatchObject({ code: 'NO_DOCUMENTS' });
    await waitFor(() => expect(api().runs).toEqual({}));
  });

  it('marks a stream that ends without terminal event as interrupted', async () => {
    const { api } = setup(async () => new Response(frame('meta', META) + frame('delta', { text: 'Teil' }), { headers: SSE }));
    await act(() => api().ask({ chatId: 'c1', question: 'x', model: 'm', locale: 'de' }));
    await waitFor(() =>
      expect(api().runs[runKey('c1')].outcome).toMatchObject({ kind: 'error', error: { code: 'STREAM_INTERRUPTED', partial: true } }),
    );
  });

  it('stops: marks the run, aborts the request and tells the server', async () => {
    let signal: AbortSignal | undefined;
    const { api, fetchMock } = setup(async (url, init) => {
      if (url.endsWith('/stop')) return Response.json({ stopped: ['a'] }, { status: 202 });
      signal = init?.signal ?? undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(frame('meta', META) + frame('delta', { text: 'Teil' })));
          signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return new Response(stream, { headers: SSE });
    });
    await act(() => api().ask({ chatId: 'c1', question: 'x', model: 'm', locale: 'de' }));
    await waitFor(() => expect(api().runs[runKey('c1')].text).toBe('Teil'));
    await act(() => api().stop('c1'));
    expect(api().runs[runKey('c1')].outcome).toEqual({ kind: 'stopped' });
    expect(signal?.aborted).toBe(true);
    const stopCall = fetchMock.mock.calls.find(([url]) => url === '/api/chats/c1/stop');
    expect(JSON.parse(String(stopCall?.[1]?.body))).toEqual({ lane: 'a' });
  });

  it('rejects a stream cut off before meta, so the question stays in the composer', async () => {
    const { api } = setup(async () => new Response('', { headers: SSE }));
    await expect(api().ask({ chatId: 'c1', question: 'x', model: 'm', locale: 'de' })).rejects.toMatchObject({
      code: 'STREAM_INTERRUPTED',
    });
    await waitFor(() => expect(api().runs).toEqual({}));
  });

  it('keeps streams of different chats apart', async () => {
    const { api } = setup(async (url) => {
      const chatId = url.split('/')[3];
      return new Response(
        frame('meta', { ...META, chat_id: chatId }) + frame('delta', { text: chatId }) + frame('done', DONE),
        { headers: SSE },
      );
    });
    await act(async () => {
      await Promise.all([
        api().ask({ chatId: 'c1', question: 'a', model: 'm', locale: 'de' }),
        api().ask({ chatId: 'c2', question: 'b', model: 'm', locale: 'de' }),
      ]);
    });
    await waitFor(() => expect(api().runs[runKey('c2')]?.outcome?.kind).toBe('done'));
    expect(api().runs[runKey('c1')].text).toBe('c1');
    expect(api().runs[runKey('c2')].text).toBe('c2');
  });
});
