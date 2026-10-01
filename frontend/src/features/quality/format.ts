import type { EvalConfigOut } from '@/shared/api/types';

export function formatShare(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value);
}

export function formatScore(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function formatMs(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: value < 5 ? 1 : 0 }).format(value);
}

/** Message keys for a configuration's name: the search, and the BM25 stemmer when it has one. */
export function configName(config: Pick<EvalConfigOut, 'search' | 'stemming'>): { search: string; stemming: string | null } {
  return { search: `search.${config.search}`, stemming: config.stemming ? `stemming.${config.stemming}` : null };
}
