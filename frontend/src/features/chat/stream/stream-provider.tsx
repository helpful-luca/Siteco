'use client';

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { fetchJson } from '@/shared/api/client';
import { clientError } from '@/shared/api/errors';
import type { Lane } from '@/shared/api/types';
import { CHATS_KEY, chatKey, messagesKey } from '../queries';
import type { StreamEvent } from './events';
import { readStream } from './read-stream';
import { createRunStore, type RunStore } from './run-store';
import { isRunning, runKey, type RunState, type StartRun } from './stream-reducer';

type Locale = 'de' | 'en';

export type AskInput = { chatId: string; question: string; model: string; locale: Locale };
export type RegenerateInput = { chatId: string; assistantId: string; question: string; model: string; locale: Locale };

/** Stable functions: consumers never re-render because an answer streams. */
export type StreamActions = {
  /**
   * Resolves `true` once the server confirmed the question (`meta`), `false` when it was stopped
   * before that; rejects with an ApiError when refused or cut off before `meta`.
   */
  ask: (input: AskInput) => Promise<boolean>;
  regenerate: (input: RegenerateInput) => Promise<boolean>;
  stop: (chatId: string) => Promise<void>;
  clear: (chatId: string) => void;
  /** The current run of a chat, read at call time (for event handlers). */
  getRun: (chatId: string) => RunState | undefined;
  store: RunStore;
};

const StreamContext = createContext<StreamActions | null>(null);
const LANE: Lane = 'a';

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

  const refresh = useCallback(
    async (chatId: string) => {
      void client.invalidateQueries({ queryKey: chatKey(chatId) });
      void client.invalidateQueries({ queryKey: CHATS_KEY });
      await client.invalidateQueries({ queryKey: messagesKey(chatId) });
      // Nobody shows this chat: the saved answer loads on the next visit, the run can go.
      const watched = client.getQueryCache().find({ queryKey: messagesKey(chatId) })?.getObserversCount() ?? 0;
      const run = store.getState()[runKey(chatId, LANE)];
      if (watched === 0 && run?.outcome) store.dispatch({ type: 'local/clear', key: runKey(chatId, LANE) });
    },
    [client, store],
  );

  const start = useCallback(
    (chatId: string, url: string, body: object, run: StartRun) => {
      const key = runKey(chatId, LANE);
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
          if (event.type === 'done' || event.type === 'error') void refresh(chatId);
        };
        readStream({ url, body, signal: controller.signal, onEvent })
          .then((end) => {
            if (!current()) return resolve(confirmed);
            flush(key);
            if (!confirmed) {
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
            if (current()) store.dispatch({ type: 'local/clear', key });
            reject(error);
          })
          .finally(() => {
            if (current()) controllers.current.delete(key);
          });
      });
    },
    [client, flush, flushAll, refresh, store],
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
      const run = store.getState()[key];
      flush(key);
      if (run && !run.meta) store.dispatch({ type: 'local/clear', key });
      else if (isRunning(run)) store.dispatch({ type: 'local/stopped', key });
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
      void refresh(chatId);
    },
    [flush, refresh, store],
  );

  const clear = useCallback((chatId: string) => store.dispatch({ type: 'local/clear', key: runKey(chatId, LANE) }), [store]);
  const getRun = useCallback((chatId: string) => store.getState()[runKey(chatId, LANE)], [store]);

  useEffect(() => {
    const open = controllers.current;
    return () => {
      for (const controller of open.values()) controller.abort();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  const value = useMemo(
    () => ({ ask, regenerate, stop, clear, getRun, store }),
    [ask, regenerate, stop, clear, getRun, store],
  );
  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

export function useStreamActions(): StreamActions {
  const actions = useContext(StreamContext);
  if (!actions) throw new Error('useStreamActions needs the StreamProvider (ChatProvider)');
  return actions;
}

/** The answer of this chat that is streaming or has just finished; re-renders only for this chat. */
export function useRun(chatId: string | null): RunState | undefined {
  const { store } = useStreamActions();
  const read = () => (chatId ? store.getState()[runKey(chatId, LANE)] : undefined);
  return useSyncExternalStore(store.subscribe, read, read);
}

/** Whether an answer is being written in this chat; changes only when that flips. */
export function useIsAnswering(chatId: string): boolean {
  const { store } = useStreamActions();
  const read = () => isRunning(store.getState()[runKey(chatId, LANE)]);
  return useSyncExternalStore(store.subscribe, read, read);
}
