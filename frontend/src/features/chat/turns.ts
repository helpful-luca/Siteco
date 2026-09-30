import type { MessageOut } from '@/shared/api/types';
import { answerFromMessage, answerFromRun, type Answer } from './answer';
import type { RunState } from './stream/stream-reducer';

export type Turn = { key: string; question: string; answer: Answer | null };

/**
 * Question and answer pairs from the persisted messages, with the live run merged in: a new
 * question is appended, a regenerated answer replaces its old version in place. Rows the run
 * owns are hidden until the persisted version has caught up.
 */
export function buildTurns(messages: MessageOut[], run: RunState | undefined): Turn[] {
  const live = run?.meta ? run : undefined;
  const hiddenUser = live && !live.regenerateOf ? live.meta?.user_message_id : undefined;
  const liveAnswerId = live?.meta?.assistant_message_id;

  const answers = new Map<string, MessageOut>();
  for (const message of messages) {
    if (message.role === 'assistant' && message.parent_id && (message.lane ?? 'a') === 'a') {
      answers.set(message.parent_id, message);
    }
  }

  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role !== 'user' || message.id === hiddenUser) continue;
    const persisted = answers.get(message.id);
    const answer =
      live && persisted && persisted.id === liveAnswerId
        ? answerFromRun(live)
        : persisted
          ? answerFromMessage(persisted)
          : null;
    turns.push({ key: message.id, question: message.content, answer });
  }
  if (live && !live.regenerateOf) {
    turns.push({ key: live.meta?.user_message_id ?? live.clientMessageId, question: live.question, answer: answerFromRun(live) });
  }
  return turns;
}

/** The finished run can go once the backend returns its answer as saved (no flicker, annex 11, 8.2). */
export function runIsPersisted(messages: MessageOut[], run: RunState): boolean {
  const id = run.meta?.assistant_message_id;
  if (!run.outcome || !id) return false;
  return messages.some((m) => m.id === id && m.status !== 'streaming');
}
