import type {
  CitationOut,
  LatencyOut,
  MessageOut,
  MessageStatus,
  NoticeOut,
  SourceOut,
  SourcesMode,
  UsageOut,
} from '@/shared/api/types';
import type { RunError, RunState } from './stream/stream-reducer';

/** One answer as the UI shows it, whether it streams right now or was loaded from the backend. */
export type Answer = {
  /** Stable across the switch from live to persisted: the assistant message id. */
  key: string;
  messageId: string | null;
  text: string;
  citations: CitationOut[];
  sources: SourceOut[];
  sourcesMode: SourcesMode | null;
  notices: NoticeOut[];
  status: MessageStatus;
  /** Only for a live run: what it is doing right now. */
  phase: RunState['phase'] | null;
  startedAt: number | null;
  error: RunError | null;
  model: string | null;
  usage: UsageOut | null;
  costUsd: number | null;
  latency: LatencyOut | null;
  live: boolean;
};

export function answerFromMessage(message: MessageOut): Answer {
  return {
    key: message.id,
    messageId: message.id,
    text: message.content,
    citations: message.citations,
    sources: message.sources,
    sourcesMode: message.sources_mode,
    notices: message.notices,
    status: message.status,
    phase: null,
    startedAt: null,
    error: message.error_code
      ? {
          code: message.error_code,
          partial: message.content.length > 0,
          requestId: message.error_request_id ?? null,
          retryAfter: null,
          params: {},
        }
      : null,
    model: message.model,
    usage: message.usage,
    costUsd: message.cost_usd,
    latency: message.latency_ms,
    live: false,
  };
}

function runStatus(run: RunState): MessageStatus {
  const outcome = run.outcome;
  if (!outcome) return 'streaming';
  if (outcome.kind === 'done') return outcome.done.status;
  if (outcome.kind === 'stopped') return 'stopped';
  return 'error';
}

export function answerFromRun(run: RunState): Answer {
  const done = run.outcome?.kind === 'done' ? run.outcome.done : null;
  return {
    key: run.meta?.assistant_message_id ?? run.clientMessageId,
    messageId: run.meta?.assistant_message_id ?? null,
    text: run.text,
    citations: run.citations,
    sources: run.sources,
    sourcesMode: run.sourcesMode,
    notices: run.notices,
    status: runStatus(run),
    phase: run.outcome ? null : run.phase,
    startedAt: run.startedAt,
    error: run.outcome?.kind === 'error' ? run.outcome.error : null,
    model: run.meta?.model ?? run.model,
    usage: done?.usage ?? null,
    costUsd: done?.cost_usd ?? null,
    latency: done?.latency_ms ?? null,
    live: true,
  };
}
