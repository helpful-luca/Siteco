import { ApiError, clientError, normalizeError } from '@/shared/api/errors';

/** JSON fetch against our own /api proxy. Every error becomes an ApiError. */
export async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { Accept: 'application/json', 'X-Requested-With': 'docchat', ...init.headers },
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw clientError('NETWORK_ERROR');
  }
  if (!res.ok) throw await normalizeError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export { ApiError };
