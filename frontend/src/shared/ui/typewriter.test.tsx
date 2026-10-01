import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Typewriter, typewriterScript } from './typewriter';

const TIMING = { type: 100, erase: 50, hold: 1000, gap: 200 };

describe('typewriterScript', () => {
  it('holds the first word, erases it, types the next and ends on the first word', () => {
    const frames = typewriterScript(['Ab', 'Cd'], 2, TIMING);
    expect(frames.map((frame) => frame.text)).toEqual(['Ab', 'A', '', 'C', 'Cd', 'C', '', 'A', 'Ab']);
    expect(frames.map((frame) => frame.phase)).toEqual([
      'hold', 'erase', 'gap', 'type', 'hold', 'erase', 'gap', 'type', 'settled',
    ]);
    expect(frames[0]?.wait).toBe(1000);
    expect(frames.at(-1)?.wait).toBe(Infinity);
  });

  it('types at a natural, slightly uneven pace and erases faster and evenly', () => {
    const frames = typewriterScript(['Willkommen', 'Welcome'], 1, TIMING);
    const typed = frames.filter((frame) => frame.phase === 'type').map((frame) => frame.wait);
    const erased = frames.filter((frame) => frame.phase === 'erase').map((frame) => frame.wait);
    expect(new Set(typed).size).toBeGreaterThan(2);
    for (const wait of typed) {
      expect(wait).toBeGreaterThanOrEqual(TIMING.type * 0.75);
      expect(wait).toBeLessThanOrEqual(TIMING.type * 1.25);
    }
    expect(new Set(erased)).toEqual(new Set([TIMING.erase]));
    expect(Math.max(...erased)).toBeLessThan(Math.min(...typed));
    // Deterministic: the same words give the same rhythm (no layout or test flakiness).
    expect(typewriterScript(['Willkommen', 'Welcome'], 1, TIMING)).toEqual(frames);
  });

  it('is a single static frame without a second word or without switches', () => {
    expect(typewriterScript(['Ab'], 4, TIMING)).toEqual([{ text: 'Ab', wait: Infinity, phase: 'settled' }]);
    expect(typewriterScript(['Ab', 'Cd'], 0, TIMING)).toEqual([{ text: 'Ab', wait: Infinity, phase: 'settled' }]);
  });
});

/** Steps the clock in small acts, so every frame's effect schedules the next timer. */
function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 10) act(() => vi.advanceTimersByTime(10));
}

describe('Typewriter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps a static accessible name while the visible text changes', () => {
    const { container } = render(
      <h2>
        <Typewriter label="Willkommen" words={['Willkommen', 'Welcome']} switches={2} timing={TIMING} />
      </h2>,
    );
    expect(screen.getByRole('heading', { name: 'Willkommen' })).toBeInTheDocument();
    const visible = () => container.querySelector('[aria-hidden]')?.textContent;
    expect(visible()).toBe('Willkommen');
    advance(1000 + 50 * 10 + 200 + 100 * 7);
    expect(visible()).toBe('Welcome');
    expect(screen.getByRole('heading', { name: 'Willkommen' })).toBeInTheDocument();
    advance(30_000);
    expect(visible()).toBe('Willkommen');
  });

  it('shows a solid caret while typing, a blinking one while a word holds, and none once settled', () => {
    const { container } = render(<Typewriter label="Ab" words={['Ab', 'Cd']} switches={2} timing={TIMING} />);
    const caret = () => container.querySelector('[data-caret]')?.getAttribute('data-caret');
    expect(caret()).toBe('blink');
    advance(1000 + 20);
    expect(caret()).toBe('solid');
    advance(50 + 200 + 100 * 2);
    expect(caret()).toBe('blink');
    advance(30_000);
    expect(caret()).toBe('off');
  });

  it('shows the label without animation when the user prefers reduced motion', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ ...original(query), matches: query.includes('reduce') })) as typeof window.matchMedia;
    try {
      const { container } = render(<Typewriter label="Willkommen" words={['Willkommen', 'Welcome']} timing={TIMING} />);
      advance(5000);
      expect(container).toHaveTextContent(/^Willkommen$/);
      expect(container.querySelector('[aria-hidden]')).toBeNull();
      expect(container.querySelector('[data-caret]')).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });
});
