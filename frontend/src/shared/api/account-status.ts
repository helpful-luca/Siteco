'use client';

import { useSyncExternalStore } from 'react';

/**
 * What an answer revealed about the Claude account that is not in `/api/config`: the credit or
 * spend limit was reached (LLM_BILLING). Cleared by the next answer that went through.
 */
let billingBlocked = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (next === billingBlocked) return;
  billingBlocked = next;
  for (const listener of listeners) listener();
}

export const accountStatus = {
  getBillingBlocked: () => billingBlocked,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  reportBillingBlocked: () => set(true),
  reportAnswerWentThrough: () => set(false),
};

export function useBillingBlocked(): boolean {
  return useSyncExternalStore(accountStatus.subscribe, accountStatus.getBillingBlocked, () => false);
}
