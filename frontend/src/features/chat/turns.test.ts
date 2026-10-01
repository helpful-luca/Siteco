import { describe, expect, it } from 'vitest';
import type { MessageOut } from '@/shared/api/types';
import { META, DONE, message } from './testing';
import { runKey, streamReducer, type RunState } from './stream/stream-reducer';
import { buildTurns, runIsPersisted } from './turns';

const user = (id: string, content: string): MessageOut =>
  message({ id, role: 'user', content, parent_id: null, sources: [], citations: [], model: null, usage: null });

function liveRun(patch: Partial<RunState> = {}): RunState {
  const key = runKey('c1');
  let state = streamReducer(
    {},
    {
      type: 'local/start',
      key,
      run: { chatId: 'c1', lane: 'a', question: 'Neu?', clientMessageId: 'x', regenerateOf: null, model: 'm', comparisonId: null, startedAt: 0 },
    },
  );
  state = streamReducer(state, { type: 'meta', key, data: { ...META, user_message_id: 'u2', assistant_message_id: 'a2' } });
  state = streamReducer(state, { type: 'delta', key, data: { text: 'Live' } });
  return { ...state[key], ...patch };
}

const persisted = [user('u1', 'Alt?'), message({ id: 'a1', parent_id: 'u1' })];

describe('buildTurns', () => {
  it('pairs questions with their answers', () => {
    const turns = buildTurns(persisted, []);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ key: 'u1', question: 'Alt?', answer: { key: 'a1', live: false } });
  });

  it('appends a live question and hides its placeholder rows', () => {
    const rows = [...persisted, user('u2', 'Neu?'), message({ id: 'a2', parent_id: 'u2', status: 'streaming', content: '' })];
    const turns = buildTurns(rows, [liveRun()]);
    expect(turns.map((t) => t.key)).toEqual(['u1', 'u2']);
    expect(turns[1].answer).toMatchObject({ key: 'a2', text: 'Live', live: true, status: 'streaming' });
  });

  it('replaces a regenerated answer in place', () => {
    const run = liveRun({ regenerateOf: 'a1', meta: { ...META, user_message_id: 'u1', assistant_message_id: 'a1' } });
    const turns = buildTurns(persisted, [run]);
    expect(turns).toHaveLength(1);
    expect(turns[0].answer).toMatchObject({ key: 'a1', live: true, text: 'Live' });
  });

  it('shows nothing live before the server confirmed the question', () => {
    const run = { ...liveRun(), meta: null };
    expect(buildTurns(persisted, [run])).toHaveLength(1);
  });
});

describe('runIsPersisted', () => {
  it('waits for the saved, finished answer', () => {
    const run = liveRun({ outcome: { kind: 'done', done: DONE } });
    expect(runIsPersisted([message({ id: 'a2', status: 'streaming' })], run)).toBe(false);
    expect(runIsPersisted([message({ id: 'a2', status: 'complete' })], run)).toBe(true);
    expect(runIsPersisted([message({ id: 'a2', status: 'complete' })], liveRun())).toBe(false);
  });
});

describe('buildTurns identity', () => {
  it('keeps unchanged turns and answers identical between renders', () => {
    const rows = [...persisted, user('u2', 'Neu?'), message({ id: 'a2', parent_id: 'u2', status: 'streaming', content: '' })];
    const run = liveRun();
    const first = buildTurns(rows, [run]);
    const second = buildTurns(rows, [run]);
    expect(second[0]).toBe(first[0]);
    expect(second[1].answer).toBe(first[1].answer);
    const next = { ...run, text: `${run.text} mehr` };
    const third = buildTurns(rows, [next]);
    expect(third[0]).toBe(first[0]);
    expect(third[1].answer).not.toBe(first[1].answer);
  });
});

describe('buildTurns with a comparison', () => {
  const comparison = { comparison_id: 'cmp1' };
  const saved = [
    user('u1', 'Welche Schutzart?'),
    message({ id: 'a1', parent_id: 'u1', lane: 'a', ...comparison, is_preferred: true }),
    message({ id: 'b1', parent_id: 'u1', lane: 'b', ...comparison, model: 'claude-haiku-4-5', is_preferred: false }),
  ];

  it('puts both lanes of a saved comparison into one turn, lane a kept by default', () => {
    const [turn] = buildTurns(saved, []);
    expect(turn.answer?.key).toBe('a1');
    expect(turn.comparison).toMatchObject({ id: 'cmp1', a: { key: 'a1' }, b: { key: 'b1', model: 'claude-haiku-4-5' }, preferred: 'a' });
  });

  it('follows the kept answer', () => {
    const rows = saved.map((m) => (m.role === 'assistant' ? { ...m, is_preferred: m.lane === 'b' } : m));
    expect(buildTurns(rows, [])[0].comparison?.preferred).toBe('b');
  });

  it('shows a live comparison with a column waiting for lane b', () => {
    const runA = liveRun({ comparisonId: 'cmp2', meta: { ...META, user_message_id: 'u2', assistant_message_id: 'a2', comparison_id: 'cmp2' } });
    const turns = buildTurns(persisted, [runA, undefined]);
    expect(turns[1].comparison).toMatchObject({ id: 'cmp2', a: { key: 'a2', live: true }, b: null });
    const runB = liveRun({
      lane: 'b',
      comparisonId: 'cmp2',
      meta: { ...META, lane: 'b', user_message_id: 'u2', assistant_message_id: 'b2', comparison_id: 'cmp2' },
    });
    expect(buildTurns(persisted, [runA, runB])[1].comparison?.b).toMatchObject({ key: 'b2', lane: 'b', live: true });
  });

  it('keeps a lane b refused before its stream in the column of its comparison', () => {
    const refused = {
      ...liveRun({ lane: 'b', comparisonId: 'cmp1', clientMessageId: 'q1' }),
      meta: null,
      outcome: { kind: 'error' as const, error: { code: 'COMPARE_SAME_MODEL', partial: false, requestId: null, retryAfter: null, params: {} } },
    };
    const onlyA = saved.slice(0, 2);
    const [turn] = buildTurns(onlyA, [undefined, refused]);
    expect(turn.comparison?.b).toMatchObject({ key: 'q1:b', status: 'error', error: { code: 'COMPARE_SAME_MODEL' } });
    expect(buildTurns(onlyA, [])[0].comparison).toBeNull();
  });
});
