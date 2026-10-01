'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { accountStatus } from '@/shared/api/account-status';
import { fetchJson } from '@/shared/api/client';
import { CONFIG_CHANGING_CODES } from '@/shared/api/error-catalog';
import { ApiError, clientError, toApiError } from '@/shared/api/errors';
import type { AnswerStyle, ConfigOut, Effort, Lane } from '@/shared/api/types';
import { CHATS_KEY, chatKey, messagesKey } from '../queries';
import type { StreamEvent } from './events';
import { readStream } from './read-stream';
import { createRunStore, type RunStore } from './run-store';
import { isRunning, runKey, type RunError, type RunState, type StartRun } from './stream-reducer';

type Locale = 'de' | 'en';

/** Answer mode and length from the settings; without them the backend's defaults apply. */
type AnswerOptions = { effort?: Effort | null; style?: AnswerStyle };

export type AskInput = { chatId: string; question: string; model: string; locale: Locale } & AnswerOptions;
export type RegenerateInput = {
  chatId: string;
  assistantId: string;
  question: string;
  model: string;
  locale: Locale;
  /** The lane of the answer being replaced (`b` in a comparison). */
  lane?: Lane;
} & AnswerOptions;
/** One column of a comparison: its model and how it writes. */
export type LaneInput = { model: string } & AnswerOptions;
export type CompareInput = { chatId: string; question: string; locale: Locale; lanes: [LaneInput, LaneInput] };
/** The second lane again, after it was refused before its stream. */
export type RetryLaneInput = {
  chatId: string;
  question: string;
  locale: Locale;
  lane: Lane;
  clientMessageId: string;
  comparisonId: string;
} & LaneInput;

/** Only what is set goes into the request body. */
function answerFields({ effort, style }: AnswerOptions): AnswerOptions {
  return { ...(effort ? { effort } : {}), ...(style ? { style } : {}) };
}

const LANES: readonly Lane[] = ['a', 'b'];

/** Stable functions: consumers never re-render because an answer streams. */
export type StreamActions = {
  /**
   * Resolves `true` once the server confirmed the question (`meta`), `false` when it was stopped
   * before that; rejects with an ApiError when refused or cut off before `meta`.
   */
  ask: (input: AskInput) => Promise<boolean>;
  /**
   * Two models, one question (annex 11, 8.6): lane a first; once it is confirmed, lane b joins
   * the same question. Resolves and rejects like `ask` for the comparison as a whole; a refusal of
   * lane b alone shows in its column.
   */
  compare: (input: CompareInput) => Promise<boolean>;
  retryLane: (input: RetryLaneInput) => Promise<boolean>;
  regenerate: (input: RegenerateInput) => Promise<boolean>;
  /** One lane, or every lane of the chat. */
  stop: (chatId: string, lane?: Lane) => Promise<void>;
  /** One lane, or every lane of the chat. */
  clear: (chatId: string, lane?: Lane) => void;
  /** The current run of a chat lane, read at call time (for event handlers). */
  getRun: (chatId: string, lane?: Lane) => RunState | undefined;
  store: RunStore;
};

function refusal(error: unknown): RunError {
  const apiError = toApiError(error);
  return {
    code: apiError.code,
    partial: false,
    requestId: apiError.requestId ?? null,
    retryAfter: apiError.retryAfter ?? null,
    params: apiError.params ?? {},
  };
}

const StreamContext = createContext<StreamActions | null>(null);

/**
 * Owns every running answer above the routes, so answers keep streaming while you switch chats
 * (annex 11, 8.2). Deltas are collected and rendered once per animation frame (8.3).
 */
export function StreamProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [store] = useState(createRunStore);
  const controllers = useRef(new Map<string, AbortController>());
  const pending = useRef(new Map<string, string>());
  const frame = useRef<number | null>(null);

  const flush = useCallback(
    (key: string) => {
      const text = pending.current.get(key);
      if (!text) return;
      pending.current.delete(key);
      store.dispatch({ type: 'delta', key, data: { text } });
    },
    [store],
  );

  const flushAll = useCallback(() => {
    frame.current = null;
    for (const key of [...pending.current.keys()]) flush(key);
  }, [flush]);

  /** What an answer tells about the whole app: a rejected key, a gone model, the budget, billing. */
  const learn = useCallback(
    (code: string | null) => {
      if (code === 'LLM_BILLING') accountStatus.reportBillingBlocked();
      if (code === null) accountStatus.reportAnswerWentThrough();
      const budgeted = client.getQueryData<ConfigOut>(['config'])?.limits.daily_budget_usd != null;
      if ((code !== null && CONFIG_CHANGING_CODES.has(code)) || (code === null && budgeted)) {
        void client.invalidateQueries({ queryKey: ['config'] });
      }
    },
    [client],
  );

  const refresh = useCallback(
    async (chatId: string) => {
      void client.invalidateQueries({ queryKey: chatKey(chatId) });
      void client.invalidateQueries({ queryKey: CHATS_KEY });
      await client.invalidateQueries({ queryKey: messagesKey(chatId) });
      // Nobody shows this chat: the saved answer loads on the next visit, the run can go.
      const watched = client.getQueryCache().find({ queryKey: messagesKey(chatId) })?.getObserversCount() ?? 0;
      if (watched > 0) return;
      for (const lane of LANES) {
        if (store.getState()[runKey(chatId, lane)]?.outcome) store.dispatch({ type: 'local/clear', key: runKey(chatId, lane) });
      }
    },
    [client, store],
  );

  const start = useCallback(
    (url: string, body: object, run: StartRun, { keepRefusal = false }: { keepRefusal?: boolean } = {}) => {
      const { chatId } = run;
      const key = runKey(chatId, run.lane);
      const controller = new AbortController();
      controllers.current.get(key)?.abort();
      controllers.current.set(key, controller);
      pending.current.delete(key);
      store.dispatch({ type: 'local/start', key, run });
      // A superseded request (a newer one for this chat started) must not touch the new run.
      const current = () => controllers.current.get(key) === controller;

      return new Promise<boolean>((resolve, reject) => {
        let confirmed = false;
        const onEvent = (event: StreamEvent) => {
          if (!current()) return;
          if (event.type === 'delta') {
            if (store.getState()[key]?.firstTokenAt === null) store.dispatch({ type: 'local/first-token', key, at: Date.now() });
            pending.current.set(key, (pending.current.get(key) ?? '') + event.data.text);
            frame.current ??= requestAnimationFrame(flushAll);
            return;
          }
          flush(key);
          store.dispatch({ ...event, key });
          if (event.type === 'meta') {
            confirmed = true;
            resolve(true);
            void client.invalidateQueries({ queryKey: CHATS_KEY });
          }
          if (event.type === 'error') learn(event.data.error.code);
          if (event.type === 'done' && event.data.status !== 'sources_only') learn(null);
          if (event.type === 'done' || event.type === 'error') void refresh(chatId);
        };
        readStream({ url, body, signal: controller.signal, onEvent })
          .then((end) => {
            if (!current()) return resolve(confirmed);
            flush(key);
            if (!confirmed) {
              if (keepRefusal && end !== 'aborted') {
                store.dispatch({ type: 'local/refused', key, error: refusal(clientError('STREAM_INTERRUPTED')) });
                return resolve(false);
              }
              // Nothing was saved yet: the question goes back to the composer with a note.
              store.dispatch({ type: 'local/clear', key });
              if (end !== 'aborted') reject(clientError('STREAM_INTERRUPTED'));
              else resolve(false);
              return;
            }
            if (end === 'interrupted') {
              store.dispatch({ type: 'local/interrupted', key });
              void refresh(chatId);
            }
          })
          .catch((error: unknown) => {
            if (error instanceof ApiError) learn(error.code);
            if (keepRefusal && current()) {
              store.dispatch({ type: 'local/refused', key, error: refusal(error) });
              return resolve(false);
            }
            if (current()) store.dispatch({ type: 'local/clear', key });
            reject(error);
          })
          .finally(() => {
            if (current()) controllers.current.delete(key);
          });
      });
    },
    [client, flush, flushAll, learn, refresh, store],
  );

  const ask = useCallback(
    ({ chatId, question, model, locale, ...options }: AskInput) => {
      const clientMessageId = crypto.randomUUID();
      return start(
        `/api/chats/${chatId}/messages`,
        { client_message_id: clientMessageId, content: question, model, locale, ...answerFields(options) },
        { chatId, lane: 'a', question, clientMessageId, regenerateOf: null, model, comparisonId: null, startedAt: Date.now() },
      );
    },
    [start],
  );

  const startLane = useCallback(
    ({ chatId, question, locale, lane, clientMessageId, comparisonId, model, ...options }: RetryLaneInput, keepRefusal: boolean) =>
      start(
        `/api/chats/${chatId}/messages`,
        {
          client_message_id: clientMessageId,
          content: question,
          model,
          locale,
          comparison: { id: comparisonId, lane },
          ...answerFields(options),
        },
        { chatId, lane, question, clientMessageId, regenerateOf: null, model, comparisonId, startedAt: Date.now() },
        { keepRefusal },
      ),
    [start],
  );

  const compare = useCallback(
    async ({ chatId, question, locale, lanes: [first, second] }: CompareInput) => {
      const shared = { chatId, question, locale, clientMessageId: crypto.randomUUID(), comparisonId: crypto.randomUUID() };
      // Lane a carries the checks of the whole comparison (two slots, counts twice), so a
      // refusal there refuses both; lane b joins only after the question is saved.
      if (!(await startLane({ ...shared, ...first, lane: 'a' }, false))) return false;
      void startLane({ ...shared, ...second, lane: 'b' }, true);
      return true;
    },
    [startLane],
  );

  const retryLane = useCallback((input: RetryLaneInput) => startLane(input, true), [startLane]);

  const regenerate = useCallback(
    ({ chatId, assistantId, question, model, locale, lane = 'a', ...options }: RegenerateInput) =>
      start(
        `/api/chats/${chatId}/messages/${assistantId}/regenerate`,
        { model, locale, ...answerFields(options) },
        // The comparison id arrives with `meta`.
        { chatId, lane, question, clientMessageId: assistantId, regenerateOf: assistantId, model, comparisonId: null, startedAt: Date.now() },
      ),
    [start],
  );

  /** Stop = mark locally, abort the fetch and tell the server (annex 11, 3.4). */
  const stop = useCallback(
    async (chatId: string, lane?: Lane) => {
      for (const each of lane ? [lane] : LANES) {
        const key = runKey(chatId, each);
        const run = store.getState()[key];
        flush(key);
        if (run && !run.meta && !run.outcome) store.dispatch({ type: 'local/clear', key });
        else if (isRunning(run)) store.dispatch({ type: 'local/stopped', key });
        controllers.current.get(key)?.abort();
      }
      try {
        await fetchJson(`/api/chats/${chatId}/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lane ? { lane } : {}),
        });
      } catch {
        // The abort already ended the answer; a failed stop call changes nothing for the user.
      }
      void refresh(chatId);
    },
    [flush, refresh, store],
  );

  const clear = useCallback(
    (chatId: string, lane?: Lane) => {
      for (const each of lane ? [lane] : LANES) store.dispatch({ type: 'local/clear', key: runKey(chatId, each) });
    },
    [store],
  );
  const getRun = useCallback((chatId: string, lane: Lane = 'a') => store.getState()[runKey(chatId, lane)], [store]);

  useEffect(() => {
    const open = controllers.current;
    return () => {
      for (const controller of open.values()) controller.abort();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  const value = useMemo(
    () => ({ ask, compare, retryLane, regenerate, stop, clear, getRun, store }),
    [ask, compare, retryLane, regenerate, stop, clear, getRun, store],
  );
  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

export function useStreamActions(): StreamActions {
  const actions = useContext(StreamContext);
  if (!actions) throw new Error('useStreamActions needs the StreamProvider (ChatProvider)');
  return actions;
}

/** The answer of this chat lane that is streaming or has just finished; re-renders only for it. */
export function useRun(chatId: string | null, lane: Lane = 'a'): RunState | undefined {
  const { store } = useStreamActions();
  const read = () => (chatId ? store.getState()[runKey(chatId, lane)] : undefined);
  return useSyncExternalStore(store.subscribe, read, read);
}

/** Whether an answer is being written in this chat (any lane); changes only when that flips. */
export function useIsAnswering(chatId: string): boolean {
  const { store } = useStreamActions();
  const read = () => LANES.some((lane) => isRunning(store.getState()[runKey(chatId, lane)]));
  return useSyncExternalStore(store.subscribe, read, read);
}
