/**
 * Client-side upload queue as a pure reducer: files wait, up to MAX_PARALLEL upload at once,
 * failures stay visible with their error until retried or dismissed. A finished upload leaves
 * the queue because the document row from the server takes over.
 */
import { preCheck, type UploadError } from './pre-check';

const MAX_PARALLEL = 3;

export type UploadState = 'waiting' | 'uploading' | 'failed';

export type UploadItem = {
  id: string;
  /** A file from this computer, or null for an import from a link (`url`). */
  file: File | null;
  url: string | null;
  /** What the row shows: the file name, or the link's last part until the server names it. */
  name: string;
  /** Bytes expected: the file's size, or a link's Content-Length once known (else null). */
  total: number | null;
  state: UploadState;
  loaded: number;
  error: UploadError | null;
  /** Uploaded into this chat (an attachment); null: into the library. */
  chatId: string | null;
  /** For a chat upload: also into the library? null until answered (then: chat only). */
  toLibrary: boolean | null;
};

export type UploadAction =
  | { type: 'add'; items: UploadItem[] }
  | { type: 'start'; id: string }
  | { type: 'progress'; id: string; loaded: number; total?: number | null }
  | { type: 'succeeded'; id: string }
  | { type: 'failed'; id: string; error: UploadError }
  | { type: 'retry'; id: string }
  | { type: 'choose'; id: string; toLibrary: boolean }
  | { type: 'dismiss'; id: string };

export function createItems(
  files: readonly File[],
  maxUploadMb: number | undefined,
  makeId: () => string,
  chatId: string | null = null,
): UploadItem[] {
  return files.map((file) => {
    const error = preCheck(file, maxUploadMb);
    return {
      id: makeId(),
      file,
      url: null,
      name: file.name,
      total: file.size,
      state: error ? 'failed' : 'waiting',
      loaded: 0,
      error,
      chatId,
      toLibrary: null,
    };
  });
}

/**
 * The name a link gets in the list until the server answers: a file name when the path ends
 * in one ("SIT_KAT.pdf"), else host and path ("www.siteco.de/de/produkte").
 */
function linkName(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    const last = decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) ?? '');
    if (/\.[a-z0-9]{1,8}$/i.test(last)) return last;
    return `${hostname}${decodeURIComponent(pathname)}`.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

/** An import from a link: the backend downloads it, the queue shows it like an upload. */
export function createLinkItem(url: string, makeId: () => string, chatId: string | null = null): UploadItem {
  return {
    id: makeId(),
    file: null,
    url,
    name: linkName(url),
    total: null,
    state: 'waiting',
    loaded: 0,
    error: null,
    chatId,
    toLibrary: null,
  };
}

function update(items: UploadItem[], id: string, patch: Partial<UploadItem>): UploadItem[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

export function uploadReducer(items: UploadItem[], action: UploadAction): UploadItem[] {
  switch (action.type) {
    case 'add':
      return [...items, ...action.items];
    case 'start':
      return update(items, action.id, { state: 'uploading', loaded: 0, error: null });
    case 'progress':
      return update(items, action.id, {
        loaded: action.loaded,
        ...(action.total !== undefined ? { total: action.total } : {}),
      });
    case 'failed':
      return update(items, action.id, { state: 'failed', error: action.error });
    case 'retry': {
      const item = items.find((i) => i.id === action.id);
      if (!item || item.state !== 'failed' || !item.error?.retryable) return items;
      return update(items, action.id, { state: 'waiting', loaded: 0, error: null });
    }
    case 'choose':
      return update(items, action.id, { toLibrary: action.toLibrary });
    case 'succeeded':
    case 'dismiss':
      return items.filter((item) => item.id !== action.id);
  }
}

/**
 * Until when the queue waits: while our own upload limit asks for a pause, starting the next
 * files would only fail them too.
 */
export function pausedUntil(items: readonly UploadItem[]): number | null {
  const until = items
    .filter((i) => i.state === 'failed' && i.error?.code === 'RATE_LIMITED' && i.error.retryAt)
    .map((i) => i.error?.retryAt ?? 0);
  return until.length ? Math.max(...until) : null;
}

/** The waiting items that may start now, oldest first, filling the free slots. */
export function nextToStart(items: readonly UploadItem[], maxParallel = MAX_PARALLEL, now = Date.now()): UploadItem[] {
  const pause = pausedUntil(items);
  if (pause !== null && now < pause) return [];
  const running = items.filter((i) => i.state === 'uploading').length;
  return items.filter((i) => i.state === 'waiting').slice(0, Math.max(0, maxParallel - running));
}

export function isBusy(items: readonly UploadItem[]): boolean {
  return items.some((i) => i.state !== 'failed');
}
