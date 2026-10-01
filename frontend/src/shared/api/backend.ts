/** Where the server side of Next.js reaches the backend (the proxy and the first render). */
export const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:8000';

/** The shared secret between proxy and backend, when one is configured. */
export function internalHeaders(): Record<string, string> {
  return process.env.INTERNAL_TOKEN ? { 'x-internal-token': process.env.INTERNAL_TOKEN } : {};
}
