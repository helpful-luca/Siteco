'use client';

import { useQuery } from '@tanstack/react-query';
import { ApiError, fetchJson } from '@/shared/api/client';
import type { EvalOut } from '@/shared/api/types';

/** The results of `make eval` baked into the backend image; they change only with a new image. */
export function useEvalResults() {
  return useQuery({
    queryKey: ['eval'],
    queryFn: () => fetchJson<EvalOut>('/api/eval'),
    staleTime: Infinity,
    retry: (count, error) => !(error instanceof ApiError && error.code === 'EVAL_RESULTS_MISSING') && count < 1,
  });
}
