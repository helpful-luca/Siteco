import type { Lane, MessageOut } from '@/shared/api/types';
import { answerFromMessage, answerFromRun, type Answer } from './answer';
import type { RunState } from './stream/stream-reducer';

/** Both answers of one question in the comparison mode. */
export type Comparison = { id: string; a: Answer | null; b: Answer | null; preferred: Lane };

export type Turn = {
  key: string;
  question: string;
  /** The single answer, or lane a of a comparison. */
  answer: Answer | null;
  comparison: Comparison | null;
};

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

function runAnswer(run: RunState, persisted?: MessageOut): Answer {
  let answer = fromRun.get(run);
  if (!answer) {
    answer = answerFromRun(run);
    // Keeping an answer is the user's choice, saved with the message; a live run cannot know it.
    if (persisted) answer = { ...answer, isPreferred: persisted.is_preferred };
    fromRun.set(run, answer);
  }
  return answer;
}

/** `starting`: lane b of a live comparison may not have started yet; its column waits. */
function comparisonOf(a: Answer | null, b: Answer | null, starting = false): Comparison | null {
  const id = a?.comparisonId ?? b?.comparisonId;
  // A saved comparison whose second lane never started reads as one answer.
  if (!id || (!b && !starting)) return null;
  return { id, a, b, preferred: b?.isPreferred && !a?.isPreferred ? 'b' : 'a' };
}

function sameTurn(turn: Turn, a: Answer | null, b: Answer | null): boolean {
  return turn.answer === a && (turn.comparison?.b ?? null) === b;
}

function turnFor(user: MessageOut, a: Answer | null, b: Answer | null): Turn {
  const cached = turnOf.get(user);
  if (cached && sameTurn(cached, a, b)) return cached;
  const turn = { key: user.id, question: user.content, answer: a, comparison: comparisonOf(a, b) };
  turnOf.set(user, turn);
  return turn;
}

/**
 * Question and answer pairs from the persisted messages, with the live runs (lanes a and b)
 * merged in: a new question is appended, a regenerated answer replaces its old version in place.
 * Rows the runs own are hidden until the persisted version has caught up. A lane refused before
 * its stream has no message; it joins the turn of its comparison.
 */
export function buildTurns(messages: MessageOut[], runs: ReadonlyArray<RunState | undefined>): Turn[] {
  const live = runs.filter((run): run is RunState => Boolean(run?.meta));
  const liveByAnswer = new Map(live.map((run) => [run.meta?.assistant_message_id, run]));
  const asking = live.filter((run) => !run.regenerateOf);
  const newQuestion = asking[0]?.meta?.user_message_id;
  const refused = runs.filter((run): run is RunState => Boolean(run && !run.meta && run.outcome && run.comparisonId));

  const answers = new Map<string, Partial<Record<Lane, MessageOut>>>();
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.parent_id) continue;
    const lanes = answers.get(message.parent_id) ?? {};
    lanes[message.lane ?? 'a'] = message;
    answers.set(message.parent_id, lanes);
  }
  const pick = (persisted: MessageOut | undefined): Answer | null => {
    if (!persisted) return null;
    const run = liveByAnswer.get(persisted.id);
    return run ? runAnswer(run, persisted) : messageAnswer(persisted);
  };
  const withRefused = (a: Answer | null, b: Answer | null): Answer | null => {
    if (b || !a?.comparisonId) return b;
    const run = refused.find((r) => r.comparisonId === a.comparisonId);
    return run ? runAnswer(run) : null;
  };

  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role !== 'user' || message.id === newQuestion) continue;
    const lanes = answers.get(message.id) ?? {};
    const a = pick(lanes.a);
    turns.push(turnFor(message, a, withRefused(a, pick(lanes.b))));
  }
  if (newQuestion) {
    const lane = (name: Lane) => asking.find((run) => run.lane === name && run.meta?.user_message_id === newQuestion);
    const runA = lane('a');
    const runB = lane('b');
    // A lane that finished first has its run cleared once its saved answer arrived; while the
    // other lane still streams, that saved answer fills its column.
    const saved = answers.get(newQuestion) ?? {};
    const a = runA ? runAnswer(runA) : pick(saved.a);
    const b = withRefused(a, runB ? runAnswer(runB) : pick(saved.b));
    const first = runA ?? runB;
    const comparison = comparisonOf(a, b, Boolean(runA?.comparisonId));
    turns.push({ key: newQuestion, question: first?.question ?? '', answer: a, comparison });
  }
  return turns;
}

/**
 * The finished run can go once the backend returns its answer as saved (no flicker).
 * A regenerated answer keeps its message id, so the cached list already holds the old,
 * finished version: it only counts once the list was loaded after the regeneration began
 * (`loadedAt`, the query's update time; polling pauses while an answer runs).
 */
export function runIsPersisted(messages: MessageOut[], run: RunState, loadedAt?: number): boolean {
  const id = run.meta?.assistant_message_id;
  if (!run.outcome || !id) return false;
  if (run.regenerateOf && (loadedAt === undefined || loadedAt < run.startedAt)) return false;
  return messages.some((m) => m.id === id && m.status !== 'streaming');
}
