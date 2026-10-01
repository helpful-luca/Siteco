export interface PollOptions {
  timeoutMs: number;
  intervalMs?: number;
  signal?: AbortSignal;
}

/** Calls `check` until it says true, the time is up or the signal aborts. */
export async function pollUntil(
  check: () => Promise<boolean>,
  { timeoutMs, intervalMs = 500, signal }: PollOptions,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!signal?.aborted) {
    if (await check()) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await sleep(Math.min(intervalMs, remaining), signal);
  }
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
