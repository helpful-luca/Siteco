'use client';

import { useSyncExternalStore } from 'react';
import { connection, type BackendState } from './connection';

/** The backend as the last request saw it. `unsure` counts as reachable until a check says no. */
export function useBackendState(): BackendState {
  return useSyncExternalStore(connection.subscribe, connection.getState, () => 'up');
}

export function useBackendDown(): boolean {
  return useBackendState() === 'down';
}
