import { describe, expect, it } from 'vitest';
import { ApiError, isAbortError, isConnectionError, normalizeError, toApiError } from '@/shared/api/errors';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('normalizeError', () => {
  it('reads a backend envelope', async () => {
    const err = await normalizeError(
      json(
        {
          error: {
            code: 'SERVICE_STARTING',
            message: 'x',
            retryable: true,
            retry_after: 3,
            request_id: 'req_1',
            params: {},
          },
        },
        503,
      ),
    );
    expect(err.code).toBe('SERVICE_STARTING');
    expect(err.retryable).toBe(true);
    expect(err.retryAfter).toBe(3);
    expect(err.requestId).toBe('req_1');
  });

  it('maps HTML error pages to UNKNOWN_ERROR', async () => {
    const err = await normalizeError(
      new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
    );
    expect(err.code).toBe('UNKNOWN_ERROR');
    expect(err.status).toBe(502);
    expect(err.retryable).toBe(true);
  });

  it('maps JSON without an envelope to UNKNOWN_ERROR', async () => {
    const err = await normalizeError(json({ detail: 'nope' }, 400));
    expect(err.code).toBe('UNKNOWN_ERROR');
  });
});

describe('one error type for every path (annex 11, 5.5)', () => {
  it('keeps the status of an HTML gateway page and makes it retryable', async () => {
    const err = await normalizeError(
      new Response('<html><body>502 Bad Gateway</body></html>', {
        status: 502,
        headers: { 'content-type': 'text/html', 'x-request-id': 'req_abcd1234' },
      }),
    );
    expect([err.code, err.status, err.retryable, err.requestId]).toEqual(['UNKNOWN_ERROR', 502, true, 'req_abcd1234']);
    expect(err.params).toEqual({ status: 502 });
  });

  it('treats an empty body like any other unknown answer', async () => {
    const err = await normalizeError(new Response(null, { status: 500 }));
    expect([err.code, err.requestId]).toEqual(['UNKNOWN_ERROR', null]);
  });

  it('reads the proxy envelope when the backend is away', async () => {
    const err = await normalizeError(
      json({ error: { code: 'BACKEND_UNAVAILABLE', retryable: true, request_id: 'req_1', params: {} } }, 503),
    );
    expect(isConnectionError(err)).toBe(true);
  });

  it('turns anything thrown into an ApiError', () => {
    expect(toApiError(new TypeError('Failed to fetch')).code).toBe('NETWORK_ERROR');
    expect(toApiError(new Error('boom')).code).toBe('UNKNOWN_ERROR');
    expect(toApiError('weird').code).toBe('UNKNOWN_ERROR');
    const known = new ApiError('CHAT_BUSY', 409);
    expect(toApiError(known)).toBe(known);
  });

  it('knows our own abort, which is never shown', () => {
    expect(isAbortError(new DOMException('stopped', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('AbortError'))).toBe(false);
  });
});
