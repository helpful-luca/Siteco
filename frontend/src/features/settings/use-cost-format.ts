'use client';

import { useFormatter } from 'next-intl';

/** US dollars as Anthropic bills them; tiny amounts keep four decimals so they are not 0.00. */
export function useCostFormat() {
  const format = useFormatter();
  return (usd: number) =>
    format.number(usd, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: usd > 0 && usd < 0.01 ? 4 : 2,
    });
}
