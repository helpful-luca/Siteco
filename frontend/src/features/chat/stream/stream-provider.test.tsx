import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DONE, META } from '../testing';
import { runKey } from './stream-reducer';
import { StreamProvider, useIsAnswering, useRun, useStreamActions } from './stream-provider';

const SSE = { 'content-type': 'text/event-stream' };
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

type Api = ReturnType<typeof useStreamActions> & { runs: ReturnType<ReturnType<typeof useStreamActions>['store']['getState']> };

function setup(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, { watched = ['c1', 'c2'] } = {}) {
  const fetchMock = vi.fn(fetchImpl);
  vi.stubGlobal('fetch', fetchMock);
  const api: { current: ReturnType<typeof useStreamActions> | null } = { current: null };
  function Probe() {
    api.current = useStreamActions();
    return null;
  }
  const client = new QueryClient();
  // An open chat view observes its messages; finished runs of unwatched chats are dropped.
  for (const chatId of watched) {
    new QueryObserver(client, { queryKey: ['messages', chatId], enabled: false }).subscribe(() => {});
  }
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <StreamProvider>
        <Probe />
      </StreamProvider>
    </QueryClientProvider>,
  );
  const view = (): Api => {
    const actions = api.current as ReturnType<typeof useStreamActions>;
    return { ...actions, runs: actions.store.getState() };
  };
  return { api: view, fetchMock, invalidate };
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

  it('drops the finished run of a chat nobody is looking at', async () => {
    const { api } = setup(async () => new Response(frame('meta', META) + frame('done', DONE), { headers: SSE }), {
      watched: [],
    });
    await act(() => api().ask({ chatId: 'c1', question: 'x', model: 'm', locale: 'de' }));
    await waitFor(() => expect(api().runs).toEqual({}));
  });

  it('renders a burst of deltas once per animation frame', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    const { api } = setup(async () => {
      const chunks = frame('meta', META) + ['Die ', 'Mira ', 'hat ', 'IP66.'].map((text) => frame('delta', { text })).join('');
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => controller.enqueue(new TextEncoder().encode(chunks)), // stays open
      });
      return new Response(stream, { headers: SSE });
    });
    await act(() => api().ask({ chatId: 'c1', question: 'x', model: 'm', locale: 'de' }));
    await waitFor(() => expect(frames).toHaveLength(1));
    expect(api().runs[runKey('c1')].text).toBe('');
    act(() => frames[0](0));
    expect(api().runs[runKey('c1')].text).toBe('Die Mira hat IP66.');
    expect(frames).toHaveLength(1);
  });

  it('ignores a superseded request once a newer one for the same chat started', async () => {
    let first = true;
    const { api } = setup(async (_url, init) => {
      if (first) {
        first = false;
        const signal = init?.signal ?? undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(frame('meta', META)));
            signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
          },
        });
        return new Response(stream, { headers: SSE });
      }
      return new Response(frame('meta', META) + frame('delta', { text: 'Neu' }) + frame('done', DONE), { headers: SSE });
    });
    await act(() => api().ask({ chatId: 'c1', question: 'alt', model: 'm', locale: 'de' }));
    await act(() => api().ask({ chatId: 'c1', question: 'neu', model: 'm', locale: 'de' }));
    await waitFor(() => expect(api().runs[runKey('c1')].outcome?.kind).toBe('done'));
    expect(api().runs[runKey('c1')]).toMatchObject({ question: 'neu', text: 'Neu' });
  });

  it('does not re-render the sidebar or other chats while an answer streams', async () => {
    const renders = { actions: 0, answering: 0, otherChat: 0, thisChat: 0 };
    function Sidebar() {
      useStreamActions();
      renders.actions += 1;
      return null;
    }
    function Dot() {
      useIsAnswering('c1');
      renders.answering += 1;
      return null;
    }
    function OtherChat() {
      useRun('c2');
      renders.otherChat += 1;
      return null;
    }
    function ThisChat() {
      useRun('c1');
      renders.thisChat += 1;
      return null;
    }
    const api: { current: ReturnType<typeof useStreamActions> | null } = { current: null };
    function Probe() {
      api.current = useStreamActions();
      return null;
    }
    const body = [frame('meta', META), ...Array.from({ length: 50 }, (_, i) => frame('delta', { text: `${i} ` }))];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            for (const chunk of body) {
              controller.enqueue(encoder.encode(chunk));
              await new Promise((resolve) => setTimeout(resolve, 1));
            }
            controller.enqueue(encoder.encode(frame('done', DONE)));
            controller.close();
          },
        });
        return new Response(stream, { headers: SSE });
      }),
    );
    const client = new QueryClient();
    new QueryObserver(client, { queryKey: ['messages', 'c1'], enabled: false }).subscribe(() => {});
    render(
      <QueryClientProvider client={client}>
        <StreamProvider>
          <Probe />
          <Sidebar />
          <Dot />
          <OtherChat />
          <ThisChat />
        </StreamProvider>
      </QueryClientProvider>,
    );
    await act(() => (api.current as ReturnType<typeof useStreamActions>).ask({ chatId: 'c1', question: 'x', model: 'm', locale: 'de' }));
    await waitFor(() => expect(api.current?.getRun('c1')?.outcome?.kind).toBe('done'));
    expect(renders.actions).toBe(1);
    expect(renders.otherChat).toBe(1);
    expect(renders.answering).toBe(3); // mount, starts answering, done
    expect(renders.thisChat).toBeGreaterThan(3);
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
