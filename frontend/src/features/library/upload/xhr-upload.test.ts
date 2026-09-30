import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/errors';
import { doc } from '../testing';
import { xhrUpload } from './xhr-upload';

class FakeXhr {
  static last: FakeXhr;
  headers: Record<string, string> = {};
  method = '';
  url = '';
  body: unknown = null;
  status = 0;
  responseText = '';
  responseHeaders: Record<string, string> = {};
  upload: { onprogress: ((e: { loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader(name: string) {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.responseHeaders['content-type'] = 'application/json';
    this.onload?.();
  }
}

vi.stubGlobal('XMLHttpRequest', FakeXhr);
afterEach(() => vi.clearAllMocks());

const file = new File(['%PDF-1.7'], 'Größe Mira.pdf');

describe('xhrUpload', () => {
  it('sends the raw file with the encoded name and reports progress', async () => {
    const onProgress = vi.fn();
    const result = xhrUpload(file, { onProgress });
    const xhr = FakeXhr.last;
    expect([xhr.method, xhr.url, xhr.body]).toEqual(['POST', '/api/documents', file]);
    expect(xhr.headers).toMatchObject({
      'Content-Type': 'application/octet-stream',
      'X-Requested-With': 'docchat',
      'X-File-Name': 'Gr%C3%B6%C3%9Fe%20Mira.pdf',
    });
    xhr.upload.onprogress?.({ loaded: 4, total: 8 });
    expect(onProgress).toHaveBeenCalledWith(4, 8);
    xhr.respond(202, { document: doc({ status: 'scanning' }) });
    await expect(result).resolves.toMatchObject({ status: 'scanning' });
  });

  it('turns an error envelope into an ApiError with its code and params', async () => {
    const result = xhrUpload(file, { onProgress: vi.fn() });
    FakeXhr.last.respond(409, {
      error: { code: 'DUPLICATE_DOCUMENT', retryable: false, params: { existing_id: 'd1' } },
    });
    await expect(result).rejects.toMatchObject({
      code: 'DUPLICATE_DOCUMENT',
      status: 409,
      params: { existing_id: 'd1' },
    });
  });

  it('reports network failures and cancellation', async () => {
    const failed = xhrUpload(file, { onProgress: vi.fn() });
    FakeXhr.last.onerror?.();
    await expect(failed).rejects.toBeInstanceOf(ApiError);
    await expect(failed).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });

    const controller = new AbortController();
    const cancelled = xhrUpload(file, { onProgress: vi.fn(), signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  });
});
