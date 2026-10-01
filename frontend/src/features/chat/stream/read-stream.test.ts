import { afterEach, describe, expect, it, vi } from 'vitest';
import { connection } from '@/shared/api/connection';
import { ApiError } from '@/shared/api/errors';
import type { StreamEvent } from './events';
import { readStream } from './read-stream';

const SSE = { 'content-type': 'text/event-stream; charset=utf-8' };

function streamOf(chunks: string[], { close = true } = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (close) controller.close();
    },
  });
}

function mockFetch(response: Response) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function read(chunks: string[], options: { close?: boolean; watchdogMs?: number } = {}) {
  mockFetch(new Response(streamOf(chunks, options), { headers: SSE }));
  const events: StreamEvent[] = [];
  const end = await readStream({
    url: '/api/chats/c1/messages',
    body: { content: 'x' },
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    watchdogMs: options.watchdogMs,
  });
  return { end, events };
}

afterEach(() => {
  vi.unstubAllGlobals();
  connection.reset();
});

describe('readStream', () => {
  it('sends the question as JSON with the app header', async () => {
    const fetchMock = mockFetch(new Response(streamOf(['event: done\ndata: {"status":"complete"}\n\n']), { headers: SSE }));
    await readStream({ url: '/api/x', body: { a: 1 }, signal: new AbortController().signal, onEvent: () => {} });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/x');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toMatchObject({ 'X-Requested-With': 'docchat', Accept: 'text/event-stream' });
  });

  it('parses events split across chunks, even inside a line', async () => {
    const { end, events } = await read([
      'event: me',
      'ta\ndata: {"chat_id":"c1"}\n\nevent: delta\ndata: {"te',
      'xt":"Hallo"}\n',
      '\n: ping\n\nevent: done\ndata: {"status":"complete"}\n\n',
    ]);
    expect(end).toBe('terminal');
    expect(events.map((e) => e.type)).toEqual(['meta', 'delta', 'done']);
    expect(events[1]).toEqual({ type: 'delta', data: { text: 'Hallo' } });
  });

  it('keeps multi-byte characters intact across chunk boundaries', async () => {
    const bytes = new TextEncoder().encode('event: delta\ndata: {"text":"Größe"}\n\nevent: done\ndata: {}\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 28)); // splits the two bytes of "ö"
        controller.enqueue(bytes.slice(28));
        controller.close();
      },
    });
    mockFetch(new Response(stream, { headers: SSE }));
    const events: StreamEvent[] = [];
    await readStream({ url: '/x', body: {}, signal: new AbortController().signal, onEvent: (e) => events.push(e) });
    expect(events[0]).toEqual({ type: 'delta', data: { text: 'Größe' } });
  });

  it('skips a malformed JSON line and unknown events, then reads on', async () => {
    const { end, events } = await read([
      'event: delta\ndata: {"text": broken\n\n',
      'event: future_event\ndata: {"x":1}\n\n',
      'event: delta\ndata: {"text":"ok"}\n\n',
      'event: error\ndata: {"error":{"code":"LLM_OVERLOADED"},"partial":true,"stage":"llm"}\n\n',
    ]);
    expect(end).toBe('terminal');
    expect(events.map((e) => e.type)).toEqual(['delta', 'error']);
  });

  it('reports a stream that closes without terminal event as interrupted', async () => {
    const { end, events } = await read(['event: delta\ndata: {"text":"Teil"}\n\n']);
    expect(end).toBe('interrupted');
    expect(events).toHaveLength(1);
  });

  it('stops waiting after the watchdog time without bytes', async () => {
    const { end } = await read(['event: delta\ndata: {"text":"Teil"}\n\n'], { close: false, watchdogMs: 20 });
    expect(end).toBe('interrupted');
  });

  it('throws the envelope of a refusal before the stream', async () => {
    mockFetch(
      Response.json(
        { error: { code: 'NO_DOCUMENTS', retryable: false, request_id: 'r1', params: {} } },
        { status: 409 },
      ),
    );
    const promise = readStream({ url: '/x', body: {}, signal: new AbortController().signal, onEvent: () => {} });
    await expect(promise).rejects.toMatchObject({ code: 'NO_DOCUMENTS', status: 409 });
    await expect(promise).rejects.toBeInstanceOf(ApiError);
  });

  it('treats an HTML page with status 200 as an unknown error, not as a stream', async () => {
    mockFetch(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
    await expect(
      readStream({ url: '/x', body: {}, signal: new AbortController().signal, onEvent: () => {} }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_ERROR' });
  });

  it('turns a failed request into NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(
      readStream({ url: '/x', body: {}, signal: new AbortController().signal, onEvent: () => {} }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('ends quietly when the user aborts', async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"a"}\n\n'));
        controller.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
      },
    });
    mockFetch(new Response(stream, { headers: SSE }));
    const events: StreamEvent[] = [];
    const promise = readStream({ url: '/x', body: {}, signal: controller.signal, onEvent: (e) => events.push(e) });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    controller.abort();
    expect(await promise).toBe('aborted');
  });

  it('asks for a check of the backend when a stream is cut off (a restart mid-answer)', async () => {
    const cut = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"Teil"}\n\n'));
        c.error(new TypeError('network error'));
      },
    });
    mockFetch(new Response(cut, { headers: SSE }));
    const end = await readStream({ url: '/x', body: {}, signal: new AbortController().signal, onEvent: () => {} });
    expect(end).toBe('interrupted');
    expect(connection.getState()).toBe('unsure');
  });

  it('marks the backend down when the question cannot be sent at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(
      readStream({ url: '/x', body: {}, signal: new AbortController().signal, onEvent: () => {} }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(connection.getState()).toBe('down');
  });

  it('carries the countdown of our own rate limit', async () => {
    mockFetch(
      Response.json(
        { error: { code: 'RATE_LIMITED', retryable: true, retry_after: 23, request_id: 'r1', params: { seconds: 23, scope: 'chat' } } },
        { status: 429, headers: { 'retry-after': '23' } },
      ),
    );
    await expect(
      readStream({ url: '/x', body: {}, signal: new AbortController().signal, onEvent: () => {} }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429, retryAfter: 23, params: { seconds: 23 } });
  });
});
