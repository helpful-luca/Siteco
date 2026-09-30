'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError } from '@/shared/api/errors';
import { useConfig } from '@/shared/api/use-config';
import { deadlineIn } from '@/shared/lib/use-countdown';
import { useAddDocumentToList } from '../queries';
import { ACCEPT_ATTRIBUTE, type UploadError } from './pre-check';
import { createItems, nextToStart, pausedUntil, uploadReducer, type UploadItem } from './upload-queue';
import { xhrUpload } from './xhr-upload';

type Uploads = {
  items: UploadItem[];
  addFiles: (files: readonly File[]) => void;
  openPicker: () => void;
  retry: (id: string) => void;
  dismiss: (id: string) => void;
};

const UploadContext = createContext<Uploads | null>(null);

function toUploadError(error: unknown): UploadError {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      params: error.params as UploadError['params'],
      retryable: error.retryable,
      retryAt: error.code === 'RATE_LIMITED' && error.retryAfter ? deadlineIn(error.retryAfter) : null,
      requestId: error.requestId,
    };
  }
  return { code: 'UNKNOWN_ERROR', params: {}, retryable: true };
}

/**
 * Uploads live above the routes, so they keep running while you navigate, and every page can
 * start one (the library button, the chat drop target, the full-window drop overlay).
 */
export function UploadProvider({ children }: { children: ReactNode }) {
  const [items, dispatch] = useReducer(uploadReducer, []);
  const { data: config } = useConfig();
  const addToList = useAddDocumentToList();
  const controllers = useRef(new Map<string, AbortController>());
  const input = useRef<HTMLInputElement>(null);
  // Bumped when a pause of the upload limit is over, so waiting files start again.
  const [resumed, setResumed] = useState(0);

  useEffect(() => {
    const pause = pausedUntil(items);
    if (pause === null || pause <= Date.now()) return;
    const timer = setTimeout(() => setResumed((n) => n + 1), pause - Date.now());
    return () => clearTimeout(timer);
  }, [items]);

  useEffect(() => {
    for (const item of nextToStart(items)) {
      const { id } = item;
      const controller = new AbortController();
      controllers.current.set(id, controller);
      dispatch({ type: 'start', id });
      xhrUpload(item.file, {
        signal: controller.signal,
        onProgress: (loaded) => dispatch({ type: 'progress', id, loaded }),
      })
        .then((document) => {
          addToList(document);
          dispatch({ type: 'succeeded', id });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          dispatch({ type: 'failed', id, error: toUploadError(error) });
        })
        .finally(() => controllers.current.delete(id));
    }
  }, [items, addToList, resumed]);

  useEffect(() => {
    const running = controllers.current;
    return () => running.forEach((controller) => controller.abort());
  }, []);

  const addFiles = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      dispatch({ type: 'add', items: createItems(files, config?.limits.max_upload_mb, () => crypto.randomUUID()) });
    },
    [config?.limits.max_upload_mb],
  );

  const dismiss = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    dispatch({ type: 'dismiss', id });
  }, []);

  const value = useMemo<Uploads>(
    () => ({
      items,
      addFiles,
      openPicker: () => input.current?.click(),
      retry: (id) => dispatch({ type: 'retry', id }),
      dismiss,
    }),
    [items, addFiles, dismiss],
  );

  return (
    <UploadContext.Provider value={value}>
      {children}
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        hidden
        tabIndex={-1}
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          event.target.value = ''; // picking the same file again must fire again
        }}
      />
    </UploadContext.Provider>
  );
}

export function useUploads(): Uploads {
  const uploads = useContext(UploadContext);
  if (!uploads) throw new Error('useUploads needs the UploadProvider');
  return uploads;
}
