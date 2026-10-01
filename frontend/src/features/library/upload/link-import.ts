/**
 * Import from a link: the backend downloads the file in the background (and checks every
 * address it is sent to); here we start the job and follow its progress until it hands over
 * the document. Cancelling stops the download on the server too.
 */
import { ApiError, fetchJson } from '@/shared/api/client';
import type { DocumentOut, ImportEnvelopeOut, ImportOut } from '@/shared/api/types';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const POLL_MS = 500;

type Options = {
  chatId: string | null;
  onProgress: (loaded: number, total: number | null) => void;
  signal?: AbortSignal;
  pollMs?: number;
};

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Import cancelled', 'AbortError'));
      },
      { once: true },
    );
  });
}

export async function importLink(url: string, { chatId, onProgress, signal, pollMs = POLL_MS }: Options): Promise<DocumentOut> {
  const started = await fetchJson<ImportEnvelopeOut>('/api/documents/import-url', {
    method: 'POST',
    headers: JSON_HEADERS,
    // Into a chat only first; the chat asks whether it should go into the library too.
    body: JSON.stringify({ url, library: chatId === null, chat_id: chatId }),
    signal,
  });
  let job: ImportOut = started.job;
  try {
    for (;;) {
      if (job.state === 'done' && job.document) return job.document;
      if (job.state === 'failed') {
        throw new ApiError(job.error_code ?? 'UNKNOWN_ERROR', 422, job.retryable, null, null, job.error_params);
      }
      onProgress(job.received_bytes, job.total_bytes);
      await wait(pollMs, signal);
      job = (await fetchJson<ImportEnvelopeOut>(`/api/documents/imports/${job.id}`, { signal })).job;
    }
  } catch (error) {
    if (signal?.aborted) {
      void fetchJson(`/api/documents/imports/${job.id}`, { method: 'DELETE' }).catch(() => undefined);
    }
    throw error;
  }
}
