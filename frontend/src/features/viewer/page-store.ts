import { useSyncExternalStore } from 'react';

export type PageState = { page: number; pages: number | null };

/**
 * Where the viewer is, shared between the panel header ("Seite 4 von 12") and the viewer body,
 * which live in different parts of the panel. One store per opened document.
 */
export type PageStore = {
  get: () => PageState;
  set: (next: PageState) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createPageStore(initial: PageState): PageStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      if (next.page === state.page && next.pages === state.pages) return;
      state = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function usePageState(store: PageStore): PageState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
