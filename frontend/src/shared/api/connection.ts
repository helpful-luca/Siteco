/**
 * Whether the backend answers. Every request reports what it saw: a connection error marks the
 * backend as down, any answer from it marks it up again. Plain module state, because requests
 * are made outside React too (the stream client, uploads).
 */
/** `unsure`: something looked wrong (a stream was cut off); shown like `up` until a check says down. */
export type BackendState = 'up' | 'unsure' | 'down';

type Listener = () => void;

let state: BackendState = 'up';
const listeners = new Set<Listener>();

function set(next: BackendState) {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

export const connection = {
  getState: (): BackendState => state,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  reportDown: () => set('down'),
  reportUp: () => set('up'),
  /** Asks for a check without showing anything yet. */
  suspect: () => {
    if (state === 'up') set('unsure');
  },
  /** Tests only. */
  reset: () => set('up'),
};
