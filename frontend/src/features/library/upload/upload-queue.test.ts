import { describe, expect, it } from 'vitest';
import { createItems, createLinkItem, isBusy, nextToStart, pausedUntil, uploadReducer, type UploadItem } from './upload-queue';

function file(name: string, size = 100): File {
  return new File([new Uint8Array(size)], name);
}

let counter = 0;
const makeId = () => `u${++counter}`;

function queue(...names: string[]): UploadItem[] {
  counter = 0;
  return createItems(names.map((n) => file(n)), 1024, makeId);
}

describe('upload queue', () => {
  it('pre-checks files when they are added', () => {
    const items = createItems([file('a.pdf'), file('b.docx'), file('c.txt', 0)], 1024, makeId);
    expect(items.map((i) => [i.state, i.error?.code ?? null])).toEqual([
      ['waiting', null],
      ['failed', 'UNSUPPORTED_TYPE'],
      ['failed', 'EMPTY_FILE'],
    ]);
  });

  it('starts at most three uploads at a time, oldest first', () => {
    let items = queue('1.pdf', '2.pdf', '3.pdf', '4.pdf', '5.pdf');
    expect(nextToStart(items).map((i) => i.name)).toEqual(['1.pdf', '2.pdf', '3.pdf']);
    for (const item of nextToStart(items)) items = uploadReducer(items, { type: 'start', id: item.id });
    expect(nextToStart(items)).toEqual([]);
    items = uploadReducer(items, { type: 'succeeded', id: items[0].id });
    expect(nextToStart(items).map((i) => i.name)).toEqual(['4.pdf']);
  });

  it('tracks progress and keeps failures with their error', () => {
    let items = queue('a.pdf');
    const [{ id }] = items;
    items = uploadReducer(items, { type: 'start', id });
    items = uploadReducer(items, { type: 'progress', id, loaded: 60 });
    expect(items[0]).toMatchObject({ state: 'uploading', loaded: 60 });
    const error = { code: 'NETWORK_ERROR', params: {}, retryable: true };
    items = uploadReducer(items, { type: 'failed', id, error });
    expect(items[0]).toMatchObject({ state: 'failed', error });
    expect(isBusy(items)).toBe(false);
  });

  it('retries only retryable failures', () => {
    let items = queue('a.pdf', 'b.docx');
    const [ok, unsupported] = items;
    items = uploadReducer(items, { type: 'start', id: ok.id });
    items = uploadReducer(items, {
      type: 'failed',
      id: ok.id,
      error: { code: 'UPLOAD_INCOMPLETE', params: {}, retryable: true },
    });
    items = uploadReducer(items, { type: 'retry', id: ok.id });
    items = uploadReducer(items, { type: 'retry', id: unsupported.id });
    expect(items.map((i) => i.state)).toEqual(['waiting', 'failed']);
    expect(isBusy(items)).toBe(true);
  });

  it('removes finished and dismissed uploads', () => {
    let items = queue('a.pdf', 'b.pdf');
    items = uploadReducer(items, { type: 'succeeded', id: items[0].id });
    items = uploadReducer(items, { type: 'dismiss', id: items[0].id });
    expect(items).toEqual([]);
  });
});

describe('pause for our own upload limit', () => {
  const limited = (retryAt: number) => ({
    code: 'RATE_LIMITED',
    params: { seconds: 20, scope: 'upload' },
    retryable: true,
    retryAt,
  });

  it('starts nothing while a rate-limited upload waits, and continues afterwards', () => {
    let items = queue('1.pdf', '2.pdf', '3.pdf');
    items = uploadReducer(items, { type: 'start', id: items[0].id });
    items = uploadReducer(items, { type: 'failed', id: items[0].id, error: limited(20_000) });
    expect(pausedUntil(items)).toBe(20_000);
    expect(nextToStart(items, 3, 19_999)).toEqual([]);
    expect(nextToStart(items, 3, 20_000).map((i) => i.name)).toEqual(['2.pdf', '3.pdf']);
  });

  it('can be retried like any retryable failure', () => {
    let items = queue('1.pdf');
    items = uploadReducer(items, { type: 'failed', id: items[0].id, error: limited(1) });
    items = uploadReducer(items, { type: 'retry', id: items[0].id });
    expect(items[0]).toMatchObject({ state: 'waiting', error: null });
    expect(pausedUntil(items)).toBeNull();
  });

  it('remembers the chat a file was dropped into, and the library answer', () => {
    let items = createItems([file('a.pdf')], 1024, makeId, 'chat-1');
    expect(items[0]).toMatchObject({ chatId: 'chat-1', toLibrary: null });
    items = uploadReducer(items, { type: 'choose', id: items[0].id, toLibrary: true });
    expect(items[0].toLibrary).toBe(true);
    expect(createItems([file('b.pdf')], 1024, makeId)[0]).toMatchObject({ chatId: null, toLibrary: null });
  });

  it('imports from a link like a file, with the size once the server tells it', () => {
    let items = [createLinkItem('https://www.siteco.de/kataloge/SIT_KAT.pdf?_=1', () => 'l1', 'c1')];
    expect(items[0]).toMatchObject({ file: null, url: 'https://www.siteco.de/kataloge/SIT_KAT.pdf?_=1', name: 'SIT_KAT.pdf', total: null, state: 'waiting', chatId: 'c1' });
    items = uploadReducer(items, { type: 'start', id: 'l1' });
    items = uploadReducer(items, { type: 'progress', id: 'l1', loaded: 10, total: 100 });
    expect(items[0]).toMatchObject({ loaded: 10, total: 100 });
    expect(createLinkItem('https://www.siteco.de/', () => 'l2', null).name).toBe('www.siteco.de');
    expect(createLinkItem('https://www.siteco.de/de/produkte/', () => 'l3', null).name).toBe('www.siteco.de/de/produkte');
  });
});
