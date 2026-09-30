'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import { fetchJson } from '@/shared/api/client';
import type { Lane } from '@/shared/api/types';
import { CHATS_KEY, chatKey, messagesKey } from '../queries';
import type { StreamEvent } from './events';
import { readStream } from './read-stream';
import { isRunning, runKey, streamReducer, type RunState, type RunsState, type StartRun } from './stream-reducer';

type Locale = 'de' | 'en';

export type AskInput = { chatId: string; question: string; model: string; locale: Locale };
export type RegenerateInput = { chatId: string; assistantId: string; question: string; model: string; locale: Locale };

type StreamApi = {
  runs: RunsState;
  /** Resolves once the server confirmed the question (`meta`); rejects with an ApiError before that. */
  ask: (input: AskInput) => Promise<void>;
  regenerate: (input: RegenerateInput) => Promise<void>;
  stop: (chatId: string) => Promise<void>;
  clear: (chatId: string) => void;
};

const StreamContext = createContext<StreamApi | null>(null);
const LANE: Lane = 'a';

/**
 * Owns every running answer above the routes, so answers keep streaming while you switch chats
 * (annex 11, 8.2). Deltas are collected and rendered once per animation frame (8.3).
 */
export function StreamProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [runs, dispatch] = useReducer(streamReducer, {});
  const runsRef = useRef(runs);
  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);
  const controllers = useRef(new Map<string, AbortController>());
  const pending = useRef(new Map<string, string>());
  const frame = useRef<number | null>(null);

  const flush = useCallback((key: string) => {
    const text = pending.current.get(key);
    if (!text) return;
    pending.current.delete(key);
    dispatch({ type: 'delta', key, data: { text } });
  }, []);

  const flushAll = useCallback(() => {
    frame.current = null;
    for (const key of [...pending.current.keys()]) flush(key);
  }, [flush]);

  const refresh = useCallback(
    (chatId: string) => {
      void client.invalidateQueries({ queryKey: messagesKey(chatId) });
      void client.invalidateQueries({ queryKey: chatKey(chatId) });
      void client.invalidateQueries({ queryKey: CHATS_KEY });
    },
    [client],
  );

  const start = useCallback(
    (chatId: string, url: string, body: object, run: StartRun) => {
      const key = runKey(chatId, LANE);
      const controller = new AbortController();
      controllers.current.get(key)?.abort();
      controllers.current.set(key, controller);
      dispatch({ type: 'local/start', key, run });

      return new Promise<void>((resolve, reject) => {
        const onEvent = (event: StreamEvent) => {
          if (event.type === 'delta') {
            pending.current.set(key, (pending.current.get(key) ?? '') + event.data.text);
            frame.current ??= requestAnimationFrame(flushAll);
            return;
          }
          flush(key);
          dispatch({ ...event, key });
          if (event.type === 'meta') {
            resolve();
            void client.invalidateQueries({ queryKey: CHATS_KEY });
          }
          if (event.type === 'done' || event.type === 'error') refresh(chatId);
        };
        readStream({ url, body, signal: controller.signal, onEvent })
          .then((end) => {
            flush(key);
            if (end === 'interrupted') {
              dispatch({ type: 'local/interrupted', key });
              refresh(chatId);
            }
            resolve(); // no-op when meta already resolved
          })
          .catch((error: unknown) => {
            dispatch({ type: 'local/clear', key });
            reject(error);
          })
          .finally(() => {
            if (controllers.current.get(key) === controller) controllers.current.delete(key);
          });
      });
    },
    [client, flush, flushAll, refresh],
  );

  const ask = useCallback(
    ({ chatId, question, model, locale }: AskInput) => {
      const clientMessageId = crypto.randomUUID();
      return start(
        chatId,
        `/api/chats/${chatId}/messages`,
        { client_message_id: clientMessageId, content: question, model, locale },
        { chatId, lane: LANE, question, clientMessageId, regenerateOf: null, model, startedAt: Date.now() },
      );
    },
    [start],
  );

  const regenerate = useCallback(
    ({ chatId, assistantId, question, model, locale }: RegenerateInput) =>
      start(
        chatId,
        `/api/chats/${chatId}/messages/${assistantId}/regenerate`,
        { model, locale },
        { chatId, lane: LANE, question, clientMessageId: assistantId, regenerateOf: assistantId, model, startedAt: Date.now() },
      ),
    [start],
  );

  /** Stop = mark locally, abort the fetch and tell the server (annex 11, 3.4). */
  const stop = useCallback(
    async (chatId: string) => {
      const key = runKey(chatId, LANE);
      const run = runsRef.current[key];
      flush(key);
      if (run && !run.meta) dispatch({ type: 'local/clear', key });
      else if (isRunning(run)) dispatch({ type: 'local/stopped', key });
      controllers.current.get(key)?.abort();
      try {
        await fetchJson(`/api/chats/${chatId}/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lane: LANE }),
        });
      } catch {
        // The abort already ended the answer; a failed stop call changes nothing for the user.
      }
      refresh(chatId);
    },
    [flush, refresh],
  );

  const clear = useCallback((chatId: string) => dispatch({ type: 'local/clear', key: runKey(chatId, LANE) }), []);

  useEffect(() => {
    const open = controllers.current;
    return () => {
      for (const controller of open.values()) controller.abort();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  const value = useMemo(() => ({ runs, ask, regenerate, stop, clear }), [runs, ask, regenerate, stop, clear]);
  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

export function useStreams(): StreamApi {
  const api = useContext(StreamContext);
  if (!api) throw new Error('useStreams needs the StreamProvider (ChatProvider)');
  return api;
}

/** The answer of this chat that is streaming or has just finished, if any. */
export function useRun(chatId: string | null): RunState | undefined {
  const { runs } = useStreams();
  return chatId ? runs[runKey(chatId, LANE)] : undefined;
}
