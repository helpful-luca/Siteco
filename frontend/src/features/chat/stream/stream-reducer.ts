import type {
  CitationOut,
  Lane,
  NoticeOut,
  SourceOut,
  SourcesMode,
  AnswerStreamEvents,
} from '@/shared/api/types';
import type { StreamEvent } from './events';

export type RunKey = string;

export function runKey(chatId: string, lane: Lane = 'a'): RunKey {
  return `${chatId}:${lane}`;
}

/** Why an answer failed, from an `error` event or from the client itself (S4, S5). */
export type RunError = {
  code: string;
  partial: boolean;
  requestId: string | null;
  retryAfter: number | null;
  params: Record<string, unknown>;
};

export type RunOutcome =
  | { kind: 'done'; done: AnswerStreamEvents['done'] }
  | { kind: 'stopped' }
  | { kind: 'error'; error: RunError };

export type RunState = {
  chatId: string;
  lane: Lane;
  question: string;
  clientMessageId: string;
  /** The assistant message a regenerate replaces. */
  regenerateOf: string | null;
  model: string;
  /** Both lanes of a comparison share it; null for a single answer. */
  comparisonId: string | null;
  startedAt: number;
  /** When the first text arrived, for the live time to first token of a comparison column. */
  firstTokenAt: number | null;
  phase: 'connecting' | 'retrieving' | 'generating' | 'retrying';
  attempt: number;
  meta: AnswerStreamEvents['meta'] | null;
  sourcesMode: SourcesMode | null;
  sources: SourceOut[];
  notices: NoticeOut[];
  text: string;
  citations: CitationOut[];
  /** Set exactly once; afterwards the run ignores every event (one terminal state, S3). */
  outcome: RunOutcome | null;
};

export type StartRun = Pick<
  RunState,
  'chatId' | 'lane' | 'question' | 'clientMessageId' | 'regenerateOf' | 'model' | 'comparisonId' | 'startedAt'
>;

type LocalAction =
  | { type: 'local/start'; key: RunKey; run: StartRun }
  | { type: 'local/stopped'; key: RunKey }
  | { type: 'local/first-token'; key: RunKey; at: number }
  /** The second lane of a comparison was refused before its stream: the error shows in its column. */
  | { type: 'local/refused'; key: RunKey; error: RunError }
  | { type: 'local/interrupted'; key: RunKey }
  | { type: 'local/clear'; key: RunKey };

export type StreamAction = (StreamEvent & { key: RunKey }) | LocalAction;

export type RunsState = Readonly<Record<RunKey, RunState>>;

function assertNever(value: never): never {
  throw new Error(`Unhandled stream action: ${JSON.stringify(value)}`);
}

function mergeNotices(current: NoticeOut[], next: NoticeOut[]): NoticeOut[] {
  const seen = new Set(current.map((n) => n.code));
  return [...current, ...next.filter((n) => !seen.has(n.code))];
}

function apply(run: RunState, action: StreamAction): RunState {
  switch (action.type) {
    case 'meta':
      return { ...run, meta: action.data, phase: run.phase === 'connecting' ? 'retrieving' : run.phase };
    case 'status':
      return { ...run, phase: action.data.phase, attempt: action.data.attempt };
    case 'sources':
      return {
        ...run,
        sourcesMode: action.data.mode,
        sources: action.data.sources,
        notices: mergeNotices(run.notices, action.data.notices),
      };
    case 'delta':
      return { ...run, phase: 'generating', text: run.text + action.data.text };
    case 'citation':
      return { ...run, citations: [...run.citations, action.data] };
    case 'done': {
      // A refusal discards the partial text (S9).
      const refused = action.data.status === 'refused';
      return {
        ...run,
        text: refused ? '' : run.text,
        citations: refused ? [] : run.citations,
        notices: mergeNotices(run.notices, action.data.notices),
        outcome: { kind: 'done', done: action.data },
      };
    }
    case 'error': {
      const { error, partial } = action.data;
      return {
        ...run,
        outcome: {
          kind: 'error',
          error: {
            code: error.code,
            partial,
            requestId: error.request_id,
            retryAfter: error.retry_after ?? null,
            params: error.params ?? {},
          },
        },
      };
    }
    case 'local/stopped':
      return { ...run, outcome: { kind: 'stopped' } };
    case 'local/first-token':
      return run.firstTokenAt === null ? { ...run, firstTokenAt: action.at } : run;
    case 'local/refused':
      return { ...run, outcome: { kind: 'error', error: action.error } };
    case 'local/interrupted':
      return {
        ...run,
        outcome: {
          kind: 'error',
          error: {
            code: 'STREAM_INTERRUPTED',
            partial: run.text.length > 0,
            requestId: run.meta?.request_id ?? null,
            retryAfter: null,
            params: {},
          },
        },
      };
    case 'local/start':
    case 'local/clear':
      return run; // handled by the caller
    default:
      return assertNever(action);
  }
}

/** All running and recently finished answers, keyed by chat and lane (annex 11, 8.2). */
export function streamReducer(state: RunsState, action: StreamAction): RunsState {
  if (action.type === 'local/start') {
    const run: RunState = {
      ...action.run,
      firstTokenAt: null,
      phase: 'connecting',
      attempt: 1,
      meta: null,
      sourcesMode: null,
      sources: [],
      notices: [],
      text: '',
      citations: [],
      outcome: null,
    };
    return { ...state, [action.key]: run };
  }
  if (action.type === 'local/clear') {
    if (!(action.key in state)) return state;
    const next = { ...state };
    delete next[action.key];
    return next;
  }
  const run = state[action.key];
  if (!run || run.outcome) return state; // unknown run or already terminal: ignore
  return { ...state, [action.key]: apply(run, action) };
}

export function isRunning(run: RunState | undefined): boolean {
  return Boolean(run && !run.outcome);
}
