/** Test data for the chat feature. Only imported by tests. */
import type { AnswerStreamEvents, ChatListItemOut, MessageOut, SourceOut } from '@/shared/api/types';

export const META: AnswerStreamEvents['meta'] = {
  request_id: 'req_1',
  chat_id: 'c1',
  user_message_id: 'u1',
  assistant_message_id: 'a1',
  model: 'claude-sonnet-5-5',
  lane: 'a',
  comparison_id: null,
};

export function source(patch: Partial<SourceOut> = {}): SourceOut {
  return {
    id: 'k1',
    index: 1,
    document_id: 'd1',
    filename: 'Mira_L_Datenblatt.pdf',
    page: 4,
    snippet: 'Schutzart IP66, Schlagfestigkeit IK08.',
    deleted: false,
    ...patch,
  };
}

export const DONE: AnswerStreamEvents['done'] = {
  status: 'complete',
  stop_reason: 'end_turn',
  usage: { input_tokens: 412, output_tokens: 96, cache_read_input_tokens: 1650, cache_creation_input_tokens: 0 },
  cost_usd: 0.00216,
  latency_ms: { ttft: 880, total: 2310 },
  notices: [],
  chat: { id: 'c1', title: 'Welche Schutzart hat die Mira?', updated_at: '2026-09-30T14:05:03Z' },
};

export function errorEvent(code: string, partial: boolean): AnswerStreamEvents['error'] {
  return {
    error: {
      code: code as AnswerStreamEvents['error']['error']['code'],
      message: code,
      retryable: true,
      retry_after: 5,
      request_id: 'req_1',
      params: {},
      details: [],
    },
    partial,
    stage: 'llm',
  };
}

export function message(patch: Partial<MessageOut> = {}): MessageOut {
  return {
    id: 'a1',
    role: 'assistant',
    content: 'Die Mira hat IP66.',
    status: 'complete',
    parent_id: 'u1',
    client_message_id: null,
    error_code: null,
    error_request_id: null,
    model: 'claude-sonnet-5-5',
    effort: 'low',
    lane: 'a',
    comparison_id: null,
    is_preferred: false,
    sources: [source()],
    sources_mode: 'retrieval',
    citations: [{ source_id: 'k1', block_start: 0, block_end: 1, cited_text: 'Schutzart IP66.', char_offset: 18 }],
    notices: [],
    usage: DONE.usage,
    cost_usd: DONE.cost_usd,
    latency_ms: DONE.latency_ms,
    created_at: '2026-09-30T14:05:00Z',
    ...patch,
  };
}

export function chat(patch: Partial<ChatListItemOut> = {}): ChatListItemOut {
  return {
    id: 'c1',
    title: 'Schutzart der Mira L',
    title_source: 'auto',
    scope: 'all',
    document_ids: [],
    created_at: '2026-09-30T10:00:00Z',
    updated_at: '2026-09-30T10:00:00Z',
    message_count: 2,
    ...patch,
  };
}
