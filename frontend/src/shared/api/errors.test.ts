import { describe, expect, it } from 'vitest';
import { normalizeError } from '@/shared/api/errors';

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
