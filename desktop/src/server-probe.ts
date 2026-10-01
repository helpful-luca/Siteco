import { pollUntil, type PollOptions } from './poll';

/** The identity `/api/health/live` reports; anything else on the port is not our app. */
export const APP_ID = 'siteco-docchat';

export type ProbeResult = 'ours' | 'other' | 'down';
export type Probe = () => Promise<ProbeResult>;

/**
 * Identity check instead of loading whatever answers on the port: only a JSON answer with
 * `app: 'siteco-docchat'` counts. "other" means something answered (another program, or our
 * frontend while the backend is still starting); "down" means nothing answered in time.
 */
export async function probeServer(baseUrl: string, { timeoutMs = 2_000 } = {}): Promise<ProbeResult> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/health/live`, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return 'down';
  }
  try {
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return 'other';
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && (body as { app?: unknown }).app === APP_ID ? 'ours' : 'other';
  } catch {
    return 'other';
  }
}

/** Polls until the probe says "ours", the time is up or the wait is aborted. */
export function waitForApp(probe: Probe, options: PollOptions): Promise<boolean> {
  return pollUntil(async () => (await probe()) === 'ours', options);
}
