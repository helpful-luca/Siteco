/**
 * One error type for the whole UI: backend envelopes, proxy errors and network failures.
 * Backend codes come from the generated contract. The codes below exist only on the client side,
 * because the backend can never produce them (it is unreachable, or the request never left).
 */
import type { BackendErrorCode } from '@/shared/api/types';

export type ClientErrorCode =
  | 'BACKEND_UNAVAILABLE'
  | 'FORBIDDEN_ORIGIN'
  | 'NETWORK_ERROR'
  | 'STREAM_INTERRUPTED'
  | 'UNKNOWN_ERROR';

type Envelope = {
  error?: {
    code?: string;
    retryable?: boolean;
    retry_after?: number | null;
    request_id?: string;
    params?: Record<string, unknown>;
  };
};

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryable = false,
    readonly retryAfter: number | null = null,
    readonly requestId: string | null = null,
    readonly params: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export type AnyErrorCode = BackendErrorCode | ClientErrorCode;

export const CLIENT_ERROR_CODES: readonly ClientErrorCode[] = [
  'BACKEND_UNAVAILABLE',
  'FORBIDDEN_ORIGIN',
  'NETWORK_ERROR',
  'STREAM_INTERRUPTED',
  'UNKNOWN_ERROR',
];

export function clientError(code: ClientErrorCode, status = 0): ApiError {
  return new ApiError(code, status, code !== 'FORBIDDEN_ORIGIN');
}

/** Our own abort (stop, navigation, cancelled upload): never shown as an error. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** The app itself cannot be reached: the proxy says so, or the request never got an answer. */
export function isConnectionError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'BACKEND_UNAVAILABLE' || error.code === 'NETWORK_ERROR');
}

/** Anything thrown becomes an ApiError, so the UI knows exactly one error type. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  // fetch rejects with a TypeError when the network is gone.
  if (error instanceof TypeError) return clientError('NETWORK_ERROR');
  return clientError('UNKNOWN_ERROR');
}

export async function normalizeError(res: Response): Promise<ApiError> {
  const requestId = res.headers.get('x-request-id');
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    try {
      const { error } = (await res.json()) as Envelope;
      if (error?.code) {
        return new ApiError(
          error.code,
          res.status,
          Boolean(error.retryable),
          error.retry_after ?? null,
          error.request_id ?? requestId,
          error.params ?? {},
        );
      }
    } catch {
      // Invalid JSON: fall through to the generic error below.
    }
  }
  // An HTML error page, an empty body or JSON without our envelope.
  return new ApiError('UNKNOWN_ERROR', res.status, res.status >= 500, null, requestId || null, {
    status: res.status,
  });
}

/** Envelope with the same shape as the backend, for errors raised by the Next.js proxy itself. */
export function envelopeResponse(
  status: number,
  code: ClientErrorCode | BackendErrorCode,
  requestId: string,
  retryable = false,
): Response {
  return Response.json(
    {
      error: {
        code,
        message: code,
        retryable,
        retry_after: null,
        request_id: requestId,
        params: {},
        details: [],
      },
    },
    { status, headers: { 'x-request-id': requestId } },
  );
}
