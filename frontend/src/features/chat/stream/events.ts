import type { AnswerStreamEvents } from '@/shared/api/types';

export type StreamEventType = keyof AnswerStreamEvents;

/** One server-sent event of the answer stream, as a union generated from the contract. */
export type StreamEvent = {
  [K in StreamEventType]: { type: K; data: AnswerStreamEvents[K] };
}[StreamEventType];

const STREAM_EVENT_TYPES = ['meta', 'status', 'sources', 'delta', 'citation', 'done', 'error'] as const;

// Fails to compile when the contract gains an event this list does not know.
type Unlisted = Exclude<StreamEventType, (typeof STREAM_EVENT_TYPES)[number]>;
export const ALL_EVENTS_LISTED: [Unlisted] extends [never] ? true : never = true;

export function isStreamEventType(name: string): name is StreamEventType {
  return (STREAM_EVENT_TYPES as readonly string[]).includes(name);
}
