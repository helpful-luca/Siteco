/**
 * One file per request as a raw body (the backend streams it to disk while counting bytes).
 * XHR instead of fetch because only XHR reports upload progress.
 */
import { connection } from '@/shared/api/connection';
import { ApiError, clientError, isConnectionError, normalizeError } from '@/shared/api/errors';
import type { DocumentEnvelopeOut, DocumentOut } from '@/shared/api/types';

type Options = {
  onProgress: (loaded: number, total: number) => void;
  signal?: AbortSignal;
};

export function xhrUpload(file: File, { onProgress, signal }: Options): Promise<DocumentOut> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    xhr.onloadend = () => signal?.removeEventListener('abort', abort);
    xhr.open('POST', '/api/documents');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Requested-With', 'docchat');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => onProgress(event.loaded, event.total || file.size);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        connection.reportUp();
        try {
          resolve((JSON.parse(xhr.responseText) as DocumentEnvelopeOut).document);
        } catch {
          reject(new ApiError('UNKNOWN_ERROR', xhr.status));
        }
        return;
      }
      const response = new Response(xhr.responseText, {
        status: xhr.status,
        headers: {
          'content-type': xhr.getResponseHeader('content-type') ?? '',
          'x-request-id': xhr.getResponseHeader('x-request-id') ?? '',
        },
      });
      normalizeError(response).then(
        (error) => {
          if (isConnectionError(error)) connection.reportDown();
          else connection.reportUp();
          reject(error);
        },
        () => reject(new ApiError('UNKNOWN_ERROR', xhr.status)),
      );
    };
    xhr.onerror = () => {
      connection.reportDown();
      reject(clientError('NETWORK_ERROR'));
    };
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
    }
    xhr.send(file);
  });
}
