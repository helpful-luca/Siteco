import { createParser } from 'eventsource-parser';
import { connection } from '@/shared/api/connection';
import { clientError, isAbortError, isConnectionError, normalizeError } from '@/shared/api/errors';
import { isStreamEventType, type StreamEvent } from './events';

/** 45 s without a single byte (pings arrive every 15 s) means the connection is dead (S5). */
export const WATCHDOG_MS = 45_000;

export type StreamEnd = 'terminal' | 'aborted' | 'interrupted';

type Options = {
  url: string;
  body: unknown;
  signal: AbortSignal;
  onEvent: (event: StreamEvent) => void;
  watchdogMs?: number;
};

/**
 * POSTs a question and reads the answer stream (annex 11, 8.3). Refusals before the stream are
 * JSON and throw an ApiError (S1, S2). Afterwards it reports how the stream ended: with its
 * terminal event, by our own abort, or cut off (S4) including the watchdog (S5). Unknown events
 * and invalid JSON are skipped (S15).
 */
export async function readStream({ url, body, signal, onEvent, watchdogMs = WATCHDOG_MS }: Options): Promise<StreamEnd> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Requested-With': 'docchat',
      },
      body: JSON.stringify(body),
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (isAbortError(error)) return 'aborted';
    connection.reportDown();
    throw clientError('NETWORK_ERROR');
  }
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('text/event-stream') || !res.body) {
    const error = await normalizeError(res);
    if (isConnectionError(error)) connection.reportDown();
    else connection.reportUp();
    throw error;
  }
  connection.reportUp();

  let terminal = false;
  const parser = createParser({
    onEvent: (message) => {
      const name = message.event ?? 'message';
      if (terminal || !isStreamEventType(name)) return;
      let data: unknown;
      try {
        data = JSON.parse(message.data);
      } catch {
        return;
      }
      if (typeof data !== 'object' || data === null) return;
      onEvent({ type: name, data } as StreamEvent);
      if (name === 'done' || name === 'error') terminal = true;
    },
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchdog = () =>
    new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), watchdogMs);
    });

  try {
    while (!terminal) {
      const next = await Promise.race([reader.read(), watchdog()]);
      clearTimeout(timer);
      if (next === 'timeout') {
        void reader.cancel().catch(() => undefined);
        connection.suspect();
        return 'interrupted';
      }
      if (next.done) break;
      parser.feed(decoder.decode(next.value, { stream: true }));
    }
  } catch (error) {
    if (signal.aborted || isAbortError(error)) return 'aborted';
    if (terminal) return 'terminal';
    connection.suspect(); // a restart or a lost connection cuts streams off: check the backend
    return 'interrupted';
  } finally {
    clearTimeout(timer);
  }
  if (terminal) {
    void reader.cancel().catch(() => undefined);
    return 'terminal';
  }
  if (signal.aborted) return 'aborted';
  connection.suspect();
  return 'interrupted';
}
