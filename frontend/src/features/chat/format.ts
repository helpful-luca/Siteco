import type { ModelInfo } from '@/shared/api/types';

/** US dollars with enough digits for fractions of a cent (annex 10, F10). */
export function formatCost(usd: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: usd > 0 && usd < 0.01 ? 4 : 2,
  }).format(usd);
}

export function formatSeconds(ms: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(ms / 1000);
}

export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function modelLabel(models: ModelInfo[] | undefined, id: string | null): string {
  if (!id) return '';
  return models?.find((m) => m.id === id)?.label ?? id;
}

/** 1 to 3: how expensive a model is compared with the others, by output price. */
export function priceLevel(models: ModelInfo[], id: string): number {
  const prices = [...new Set(models.map((m) => m.output_usd_per_mtok))].sort((a, b) => a - b);
  const price = models.find((m) => m.id === id)?.output_usd_per_mtok;
  if (price === undefined || prices.length <= 1) return 1;
  return Math.min(3, 1 + Math.round((prices.indexOf(price) / (prices.length - 1)) * 2));
}

/**
 * Another model to try when Claude is overloaded (annex 10, H25): the default if it is not the
 * one that failed, else the first other model that still answers (the list starts with the
 * fastest).
 */
export function alternateModel(models: ModelInfo[] | undefined, current: string | null, defaultModel?: string): string | null {
  const others = (models ?? []).filter((m) => m.available && m.id !== current);
  return (others.find((m) => m.id === defaultModel) ?? others[0])?.id ?? null;
}
