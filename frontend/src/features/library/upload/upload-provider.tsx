'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError } from '@/shared/api/errors';
import { useConfig } from '@/shared/api/use-config';
import { deadlineIn } from '@/shared/lib/use-countdown';
import { useAddAttachmentToList, useAddDocumentToList, useAddToLibrary } from '../queries';
import { ACCEPT_ATTRIBUTE, type UploadError } from './pre-check';
import { createItems, nextToStart, pausedUntil, uploadReducer, type UploadItem } from './upload-queue';
import { xhrUpload } from './xhr-upload';

/** Where files dropped on the window go while a chat is open (else: the library). */
export type DropTarget = { onFiles: (files: File[]) => void };

type Uploads = {
  items: UploadItem[];
  /** `chatId`: into that chat (an attachment); without: into the library. */
  addFiles: (files: readonly File[], chatId?: string | null) => void;
  /** The file dialog; the chosen files go into the chat, or to `onFiles` when given. */
  openPicker: (target?: { chatId?: string | null; onFiles?: (files: File[]) => void }) => void;
  retry: (id: string) => void;
  dismiss: (id: string) => void;
  /** Answer to "also into the library?" for an upload still on its way. */
  choose: (id: string, toLibrary: boolean) => void;
  /** Attachments whose upload finished before the question was answered. */
  asking: readonly string[];
  /** Answer for such an attachment: into the library, or keep it in the chat only. */
  answer: (documentId: string, toLibrary: boolean) => void;
  dropTarget: DropTarget | null;
  setDropTarget: (target: DropTarget | null) => void;
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
 * start one (the library button, the chat's attach button, the full-window drop overlay).
 * An upload in a chat is an attachment of that chat; the chat asks whether it should also go
 * into the library (default: no).
 */
export function UploadProvider({ children }: { children: ReactNode }) {
  const [items, dispatch] = useReducer(uploadReducer, []);
  const { data: config } = useConfig();
  const addToList = useAddDocumentToList();
  const addAttachment = useAddAttachmentToList();
  const { mutate: addToLibrary } = useAddToLibrary();
  const controllers = useRef(new Map<string, AbortController>());
  const input = useRef<HTMLInputElement>(null);
  const pickTarget = useRef<{ chatId?: string | null; onFiles?: (files: File[]) => void }>({});
  const latest = useRef(items);
  const [asking, setAsking] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  useEffect(() => {
    latest.current = items;
  }, [items]);
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
      const { chatId } = item;
      xhrUpload(item.file, {
        signal: controller.signal,
        chatId,
        onProgress: (loaded) => dispatch({ type: 'progress', id, loaded }),
      })
        .then((document) => {
          if (chatId === null) {
            addToList(document);
          } else {
            addAttachment(chatId, document);
            // The answer may have come while the file was on its way.
            const toLibrary = latest.current.find((i) => i.id === id)?.toLibrary ?? null;
            if (!document.in_library && toLibrary === true) addToLibrary(document.id);
            if (!document.in_library && toLibrary === null) setAsking((ids) => [...ids, document.id]);
          }
          dispatch({ type: 'succeeded', id });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          dispatch({ type: 'failed', id, error: toUploadError(error) });
        })
        .finally(() => controllers.current.delete(id));
    }
  }, [items, addToList, addAttachment, addToLibrary, resumed]);

  useEffect(() => {
    const running = controllers.current;
    return () => running.forEach((controller) => controller.abort());
  }, []);

  const addFiles = useCallback(
    (files: readonly File[], chatId: string | null = null) => {
      if (files.length === 0) return;
      dispatch({
        type: 'add',
        items: createItems(files, config?.limits.max_upload_mb, () => crypto.randomUUID(), chatId),
      });
    },
    [config?.limits.max_upload_mb],
  );

  const answer = useCallback(
    (documentId: string, toLibrary: boolean) => {
      setAsking((ids) => ids.filter((other) => other !== documentId));
      if (toLibrary) addToLibrary(documentId);
    },
    [addToLibrary],
  );

  const dismiss = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    dispatch({ type: 'dismiss', id });
  }, []);

  const value = useMemo<Uploads>(
    () => ({
      items,
      addFiles,
      openPicker: (target = {}) => {
        pickTarget.current = target;
        input.current?.click();
      },
      retry: (id) => dispatch({ type: 'retry', id }),
      dismiss,
      choose: (id, toLibrary) => dispatch({ type: 'choose', id, toLibrary }),
      asking,
      answer,
      dropTarget,
      setDropTarget,
    }),
    [items, addFiles, dismiss, asking, answer, dropTarget],
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
          const files = Array.from(event.target.files ?? []);
          const { chatId = null, onFiles } = pickTarget.current;
          pickTarget.current = {};
          if (onFiles) {
            if (files.length > 0) onFiles(files);
          } else {
            addFiles(files, chatId);
          }
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
