import { connection } from './connection';
import { ApiError, clientError, isAbortError, isConnectionError, normalizeError } from './errors';

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
    if (isAbortError(err)) throw err;
    connection.reportDown();
    throw clientError('NETWORK_ERROR');
  }
  if (!res.ok) {
    const error = await normalizeError(res);
    if (isConnectionError(error)) connection.reportDown();
    else connection.reportUp();
    throw error;
  }
  connection.reportUp();
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export { ApiError };
