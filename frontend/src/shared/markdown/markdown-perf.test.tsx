import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/shared/ui';
import de from '../../../messages/de.json';
import { Markdown } from './markdown';

// Counts how many characters react-markdown parses in total.
const parsed = vi.hoisted(() => ({ chars: 0 }));
vi.mock('react-markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-markdown')>();
  const Counting = (props: Parameters<typeof actual.default>[0]) => {
    parsed.chars += String(props.children ?? '').length;
    return actual.default(props);
  };
  return { ...actual, default: Counting };
});

function paragraph(i: number): string {
  return `Absatz ${i}: Die Mira L ist nach IP66 geschützt und nach IK09 schlagfest, geprüft mit Glasabdeckung.\n\n`;
}

describe('Markdown while streaming (performance)', () => {
  it('parses a 20k character answer streamed in 400 frames roughly once, not once per frame', () => {
    let full = '';
    while (full.length < 20_000) full += paragraph(full.length);
    const step = Math.ceil(full.length / 400);
    const wrap = (text: string, streaming: boolean) => (
      <NextIntlClientProvider locale="de" messages={de}>
        <TooltipProvider>
          <Markdown text={text} streaming={streaming} />
        </TooltipProvider>
      </NextIntlClientProvider>
    );
    const { rerender, container } = render(wrap('', true));
    for (let end = step; end < full.length + step; end += step) rerender(wrap(full.slice(0, end), true));
    // Re-parsing everything each frame would be about 400 * 10k = 4M characters.
    expect(parsed.chars).toBeLessThan(full.length * 3);
    expect(container.querySelectorAll('p').length).toBe(full.split('\n\n').filter(Boolean).length);
  });
});
