import type { DocumentOut, DocumentStatus, NoticeOut } from '@/shared/api/types';

export type StatusGroup = 'ready' | 'working' | 'failed';
export type StatusFilter = 'all' | StatusGroup;
export type Tone = 'neutral' | 'working' | 'ready' | 'failed';

export type StatusView = {
  tone: Tone;
  /** The stage without numbers, for screen reader announcements (`library.announce`). */
  stage: string;
  /** Key in the `library.status` messages. */
  key: string;
  values: Record<string, number>;
  /** 0..1 within the current stage, or null when there is no measurable progress. */
  progress: number | null;
};

// `deleting` counts too: polling shows the row leaving once the delete is done.
const IN_PROGRESS: readonly DocumentStatus[] = ['scanning', 'queued', 'parsing', 'embedding', 'deleting'];
const POLL_MS = 1000;

export function isInProgress(status: DocumentStatus): boolean {
  return IN_PROGRESS.includes(status);
}

export function statusGroup(status: DocumentStatus): StatusGroup {
  if (status === 'ready') return 'ready';
  if (status === 'failed') return 'failed';
  return 'working';
}

export function statusView(document: DocumentOut): StatusView {
  const percent = Math.round(document.progress * 100);
  switch (document.status) {
    case 'scanning':
      return { tone: 'working', stage: 'scanning', key: 'scanning', values: {}, progress: null };
    case 'queued':
      return document.queue_position
        ? {
            tone: 'neutral',
            stage: 'queued',
            key: 'queuedAt',
            values: { position: document.queue_position },
            progress: null,
          }
        : { tone: 'neutral', stage: 'queued', key: 'queued', values: {}, progress: null };
    case 'parsing':
    case 'embedding': {
      // Scanned pages take seconds each: the OCR stage gets its own label.
      const recognizing = document.notices.some((n) => n.code === 'OCR_RUNNING');
      const stage = document.status === 'parsing' && recognizing ? 'recognizing' : document.status;
      return { tone: 'working', stage, key: stage, values: { percent }, progress: document.progress };
    }
    case 'ready':
      return { tone: 'ready', stage: 'ready', key: 'ready', values: {}, progress: null };
    case 'failed':
      return { tone: 'failed', stage: 'failed', key: 'failed', values: {}, progress: null };
    default:
      return { tone: 'neutral', stage: 'deleting', key: 'deleting', values: {}, progress: null };
  }
}

/** Notices worth showing now: the running OCR hint is stale once the document left `parsing`. */
export function visibleNotices(document: DocumentOut): NoticeOut[] {
  return document.notices.filter((n) => n.code !== 'OCR_RUNNING' || document.status === 'parsing');
}

export function matchesFilter(group: StatusGroup, filter: StatusFilter): boolean {
  return filter === 'all' || group === filter;
}

function fold(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase();
}

/** Case-insensitive, and NFD names from macOS match NFC queries. */
export function matchesQuery(filename: string, query: string): boolean {
  const needle = fold(query.trim());
  return needle === '' || fold(filename).includes(needle);
}

/** TanStack Query refetch interval: poll only while a document is still being processed. */
export function pollInterval(documents: readonly DocumentOut[] | undefined): number | false {
  return documents?.some((d) => isInProgress(d.status)) ? POLL_MS : false;
}
