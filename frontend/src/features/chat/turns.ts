import type { MessageOut } from '@/shared/api/types';
import { answerFromMessage, answerFromRun, type Answer } from './answer';
import type { RunState } from './stream/stream-reducer';

export type Turn = { key: string; question: string; answer: Answer | null };

// Saved messages and runs are immutable snapshots: their view models are built once, so turns
// that did not change keep their identity and memoised rows skip rendering.
const fromMessage = new WeakMap<MessageOut, Answer>();
const fromRun = new WeakMap<RunState, Answer>();
const turnOf = new WeakMap<MessageOut, Turn>();

function messageAnswer(message: MessageOut): Answer {
  let answer = fromMessage.get(message);
  if (!answer) {
    answer = answerFromMessage(message);
    fromMessage.set(message, answer);
  }
  return answer;
}

function runAnswer(run: RunState): Answer {
  let answer = fromRun.get(run);
  if (!answer) {
    answer = answerFromRun(run);
    fromRun.set(run, answer);
  }
  return answer;
}

function turnFor(user: MessageOut, answer: Answer | null): Turn {
  const cached = turnOf.get(user);
  if (cached && cached.answer === answer) return cached;
  const turn = { key: user.id, question: user.content, answer };
  turnOf.set(user, turn);
  return turn;
}

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
      live && persisted && persisted.id === liveAnswerId ? runAnswer(live) : persisted ? messageAnswer(persisted) : null;
    turns.push(turnFor(message, answer));
  }
  if (live && !live.regenerateOf) {
    turns.push({ key: live.meta?.user_message_id ?? live.clientMessageId, question: live.question, answer: runAnswer(live) });
  }
  return turns;
}

/** The finished run can go once the backend returns its answer as saved (no flicker, annex 11, 8.2). */
export function runIsPersisted(messages: MessageOut[], run: RunState): boolean {
  const id = run.meta?.assistant_message_id;
  if (!run.outcome || !id) return false;
  return messages.some((m) => m.id === id && m.status !== 'streaming');
}
