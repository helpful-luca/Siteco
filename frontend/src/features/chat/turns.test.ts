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
      run: { chatId: 'c1', lane: 'a', question: 'Neu?', clientMessageId: 'x', regenerateOf: null, model: 'm', startedAt: 0 },
    },
  );
  state = streamReducer(state, { type: 'meta', key, data: { ...META, user_message_id: 'u2', assistant_message_id: 'a2' } });
  state = streamReducer(state, { type: 'delta', key, data: { text: 'Live' } });
  return { ...state[key], ...patch };
}

const persisted = [user('u1', 'Alt?'), message({ id: 'a1', parent_id: 'u1' })];

describe('buildTurns', () => {
  it('pairs questions with their answers', () => {
    const turns = buildTurns(persisted, undefined);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ key: 'u1', question: 'Alt?', answer: { key: 'a1', live: false } });
  });

  it('appends a live question and hides its placeholder rows', () => {
    const rows = [...persisted, user('u2', 'Neu?'), message({ id: 'a2', parent_id: 'u2', status: 'streaming', content: '' })];
    const turns = buildTurns(rows, liveRun());
    expect(turns.map((t) => t.key)).toEqual(['u1', 'u2']);
    expect(turns[1].answer).toMatchObject({ key: 'a2', text: 'Live', live: true, status: 'streaming' });
  });

  it('replaces a regenerated answer in place', () => {
    const run = liveRun({ regenerateOf: 'a1', meta: { ...META, user_message_id: 'u1', assistant_message_id: 'a1' } });
    const turns = buildTurns(persisted, run);
    expect(turns).toHaveLength(1);
    expect(turns[0].answer).toMatchObject({ key: 'a1', live: true, text: 'Live' });
  });

  it('shows nothing live before the server confirmed the question', () => {
    const run = { ...liveRun(), meta: null };
    expect(buildTurns(persisted, run)).toHaveLength(1);
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
    const first = buildTurns(rows, run);
    const second = buildTurns(rows, run);
    expect(second[0]).toBe(first[0]);
    expect(second[1].answer).toBe(first[1].answer);
    const next = { ...run, text: `${run.text} mehr` };
    const third = buildTurns(rows, next);
    expect(third[0]).toBe(first[0]);
    expect(third[1].answer).not.toBe(first[1].answer);
  });
});
