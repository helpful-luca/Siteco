import { describe, expect, it } from 'vitest';
import { DONE, errorEvent, META, source } from '../testing';
import { isRunning, runKey, streamReducer, type RunsState, type StreamAction } from './stream-reducer';

const key = runKey('c1');

function start(): RunsState {
  return streamReducer(
    {},
    {
      type: 'local/start',
      key,
      run: {
        chatId: 'c1',
        lane: 'a',
        question: 'Welche Schutzart?',
        clientMessageId: 'x1',
        regenerateOf: null,
        model: 'claude-sonnet-5-5',
        comparisonId: null,
        startedAt: 0,
      },
    },
  );
}

const run = (actions: StreamAction[]) => actions.reduce(streamReducer, start())[key];

describe('streamReducer', () => {
  it('starts a run in the connecting phase', () => {
    const state = start()[key];
    expect(state.phase).toBe('connecting');
    expect(state.outcome).toBeNull();
    expect(isRunning(state)).toBe(true);
  });

  it('follows every event of a complete answer', () => {
    const state = run([
      { type: 'meta', key, data: META },
      { type: 'status', key, data: { phase: 'retrieving', attempt: 1 } },
      {
        type: 'sources',
        key,
        data: { mode: 'retrieval', sources: [source()], notices: [{ code: 'SOURCES_PARTIAL', params: { count: 1 } }] },
      },
      { type: 'status', key, data: { phase: 'generating', attempt: 1 } },
      { type: 'delta', key, data: { text: 'Die Mira hat ' } },
      { type: 'delta', key, data: { text: 'IP66.' } },
      {
        type: 'citation',
        key,
        data: { source_id: 'k1', block_start: 0, block_end: 1, cited_text: 'IP66', char_offset: 18 },
      },
      { type: 'done', key, data: { ...DONE, notices: [{ code: 'MODEL_SWITCHED', params: { old: 'a', new: 'b' } }] } },
    ]);
    expect(state.meta).toEqual(META);
    expect(state.sourcesMode).toBe('retrieval');
    expect(state.sources).toHaveLength(1);
    expect(state.text).toBe('Die Mira hat IP66.');
    expect(state.citations).toHaveLength(1);
    expect(state.notices.map((n) => n.code)).toEqual(['SOURCES_PARTIAL', 'MODEL_SWITCHED']);
    expect(state.outcome).toEqual({ kind: 'done', done: expect.objectContaining({ status: 'complete' }) });
    expect(isRunning(state)).toBe(false);
  });

  it('shows a retry as its own phase', () => {
    const state = run([
      { type: 'meta', key, data: META },
      { type: 'status', key, data: { phase: 'retrying', attempt: 2 } },
    ]);
    expect(state.phase).toBe('retrying');
    expect(state.attempt).toBe(2);
  });

  it('ignores everything after the terminal event', () => {
    const state = run([
      { type: 'meta', key, data: META },
      { type: 'delta', key, data: { text: 'A' } },
      { type: 'done', key, data: DONE },
      { type: 'delta', key, data: { text: 'B' } },
      { type: 'error', key, data: errorEvent('LLM_OVERLOADED', true) },
      { type: 'local/interrupted', key },
    ]);
    expect(state.text).toBe('A');
    expect(state.outcome?.kind).toBe('done');
  });

  it('keeps partial text on a mid-stream error', () => {
    const state = run([
      { type: 'meta', key, data: META },
      { type: 'delta', key, data: { text: 'Halb' } },
      { type: 'error', key, data: errorEvent('LLM_OVERLOADED', true) },
    ]);
    expect(state.text).toBe('Halb');
    expect(state.outcome).toEqual({
      kind: 'error',
      error: { code: 'LLM_OVERLOADED', partial: true, requestId: 'req_1', retryAfter: 5, params: {} },
    });
  });

  it('discards the partial text of a refusal', () => {
    const state = run([
      { type: 'meta', key, data: META },
      { type: 'delta', key, data: { text: 'Ich kann' } },
      { type: 'done', key, data: { ...DONE, status: 'refused', notices: [{ code: 'LLM_REFUSED', params: {} }] } },
    ]);
    expect(state.text).toBe('');
    expect(state.notices.map((n) => n.code)).toEqual(['LLM_REFUSED']);
  });

  it('turns a stream without terminal event into STREAM_INTERRUPTED', () => {
    const withText = run([
      { type: 'meta', key, data: META },
      { type: 'delta', key, data: { text: 'Teil' } },
      { type: 'local/interrupted', key },
    ]);
    expect(withText.outcome).toMatchObject({ kind: 'error', error: { code: 'STREAM_INTERRUPTED', partial: true } });
    const empty = run([{ type: 'meta', key, data: META }, { type: 'local/interrupted', key }]);
    expect(empty.outcome).toMatchObject({ kind: 'error', error: { code: 'STREAM_INTERRUPTED', partial: false } });
  });

  it('marks a stop by the user without an error', () => {
    const state = run([
      { type: 'meta', key, data: META },
      { type: 'delta', key, data: { text: 'Teil' } },
      { type: 'local/stopped', key },
    ]);
    expect(state.outcome).toEqual({ kind: 'stopped' });
    expect(state.text).toBe('Teil');
  });

  it('ignores events of unknown runs and clears finished ones', () => {
    const state = start();
    expect(streamReducer(state, { type: 'delta', key: 'other:a', data: { text: 'x' } })).toBe(state);
    expect(streamReducer(state, { type: 'local/clear', key })).toEqual({});
    expect(streamReducer({}, { type: 'local/clear', key })).toEqual({});
  });

  it('keeps runs of other chats untouched (multichat)', () => {
    const other = runKey('c2');
    const state = streamReducer(start(), {
      type: 'local/start',
      key: other,
      run: { chatId: 'c2', lane: 'a', question: 'Q', clientMessageId: 'x2', regenerateOf: null, model: 'm', comparisonId: null, startedAt: 0 },
    });
    const next = streamReducer(state, { type: 'delta', key, data: { text: 'A' } });
    expect(next[other]).toBe(state[other]);
    expect(next[key].text).toBe('A');
  });

  it('adds cited sources in full-context mode and starts over when the mode changes', () => {
    const a = source();
    const b = { ...source(), id: 'other', index: 2 };
    const added = run([
      { type: 'sources', key, data: { mode: 'full_context', sources: [], notices: [] } },
      { type: 'sources', key, data: { mode: 'full_context', sources: [a], notices: [] } },
      { type: 'sources', key, data: { mode: 'full_context', sources: [a, b], notices: [] } },
    ]);
    expect(added.sources.map((s) => s.id)).toEqual([a.id, 'other']);
    const switched = run([
      { type: 'sources', key, data: { mode: 'full_context', sources: [a], notices: [] } },
      { type: 'sources', key, data: { mode: 'retrieval', sources: [b], notices: [] } },
    ]);
    expect(switched.sources.map((s) => s.id)).toEqual(['other']);
  });
});
