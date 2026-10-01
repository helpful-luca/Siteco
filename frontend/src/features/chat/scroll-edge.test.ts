import { describe, expect, it } from 'vitest';
import { scrollEdgeMask } from './scroll-edge';

describe('scrollEdgeMask', () => {
  it('fades the list out above the composer, so no text shows behind or below it', () => {
    const mask = scrollEdgeMask({ scrolled: false, dockHeight: 80 });
    expect(mask).toBe(
      'linear-gradient(to bottom, black 0px, black calc(100% - 112px), transparent calc(100% - 80px))',
    );
  });

  it('also fades the top edge once the list is scrolled', () => {
    const mask = scrollEdgeMask({ scrolled: true, dockHeight: 80 });
    expect(mask).toBe(
      'linear-gradient(to bottom, transparent 0px, black 40px, black calc(100% - 112px), transparent calc(100% - 80px))',
    );
  });
});
