import { streamReducer, type RunsState, type StreamAction } from './stream-reducer';

export type RunStore = {
  getState: () => RunsState;
  dispatch: (action: StreamAction) => void;
  subscribe: (listener: () => void) => () => void;
};

/**
 * The running answers as a tiny external store: dispatch updates the state synchronously and
 * components subscribe to exactly the slice they show (useSyncExternalStore), so a delta in one
 * chat does not re-render the sidebar or other chats.
 */
export function createRunStore(): RunStore {
  let state: RunsState = {};
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch: (action) => {
      const next = streamReducer(state, action);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
