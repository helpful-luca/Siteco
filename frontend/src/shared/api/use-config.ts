'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchJson } from './client';
import type { ConfigOut } from './types';

/** Backend configuration (limits, features). Changes only with a restart. */
export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => fetchJson<ConfigOut>('/api/config'),
    staleTime: Infinity,
  });
}
