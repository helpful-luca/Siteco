/** Readable aliases for the generated contract types. Never edit schema.gen.ts by hand. */
import type { components } from '@/shared/api/schema.gen';

type Schemas = components['schemas'];

export type BackendErrorCode = Schemas['ErrorCode'];
export type ConfigOut = Schemas['ConfigOut'];
export type ReadyOut = Schemas['ReadyOut'];
export type DocumentOut = Schemas['DocumentOut'];
export type DocumentListOut = Schemas['DocumentListOut'];
export type DocumentEnvelopeOut = Schemas['DocumentEnvelopeOut'];
export type DocumentStatus = Schemas['DocumentStatus'];
export type DocumentKind = Schemas['DocumentKind'];
export type ChunkOut = Schemas['ChunkOut'];
export type NoticeOut = Schemas['NoticeOut'];
export type NoticeCode = Schemas['NoticeCode'];
export type Limits = Schemas['Limits'];

export type ChatOut = Schemas['ChatOut'];
export type ChatListItemOut = Schemas['ChatListItemOut'];
export type ChatListOut = Schemas['ChatListOut'];
export type ChatEnvelopeOut = Schemas['ChatEnvelopeOut'];
export type ChatScope = Schemas['ChatScope'];
export type CreateChatIn = Schemas['CreateChatIn'];
export type UpdateChatIn = Schemas['UpdateChatIn'];
export type MessageOut = Schemas['MessageOut'];
export type MessageListOut = Schemas['MessageListOut'];
export type MessageStatus = Schemas['MessageStatus'];
export type SourceOut = Schemas['SourceOut'];
export type CitationOut = Schemas['CitationOut'];
export type UsageOut = Schemas['UsageOut'];
export type LatencyOut = Schemas['LatencyOut'];
export type AskIn = Schemas['AskIn'];
export type RegenerateIn = Schemas['RegenerateIn'];
export type StopIn = Schemas['StopIn'];
export type StopOut = Schemas['StopOut'];
export type ModelInfo = Schemas['ModelInfo'];
export type Effort = Schemas['Effort'];
export type AnswerStyle = Schemas['AnswerStyle'];
export type Lane = Schemas['Lane'];
export type PreferencesBody = Schemas['PreferencesBody'];
export type WorkspaceOut = Schemas['WorkspaceOut'];
export type SourcesMode = Schemas['SourcesMode'];

/** Payloads of the answer stream (`POST /api/chats/{id}/messages`), keyed by SSE event name. */
export type AnswerStreamEvents = {
  meta: Schemas['SseMeta'];
  status: Schemas['SseStatus'];
  sources: Schemas['SseSources'];
  delta: Schemas['SseDelta'];
  citation: Schemas['SseCitation'];
  done: Schemas['SseDone'];
  error: Schemas['SseError'];
};

export type EvalOut = Schemas['EvalOut'];
export type EvalConfigOut = Schemas['EvalConfigOut'];
export type EvalMetricsOut = Schemas['EvalMetricsOut'];
export type EvalMissOut = Schemas['EvalMissOut'];
export type QuestionCategory = Schemas['QuestionCategory'];
export type SearchMode = Schemas['SearchMode'];
export type GenerationModelOut = Schemas['GenerationModelOut'];
