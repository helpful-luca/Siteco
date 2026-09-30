import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Countdown } from './countdown';

const format = (seconds: number) => `In ${seconds} Sekunden geht es weiter.`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 30, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

function live(container: HTMLElement): string {
  return container.querySelector('[aria-live]')?.textContent ?? '';
}

describe('Countdown', () => {
  it('counts down visibly but announces only the start and the end', () => {
    const onEnd = vi.fn();
    const { container } = render(
      <Countdown until={Date.now() + 3000} format={format} done="Du kannst weitermachen." onEnd={onEnd} />,
    );
    const announcements = new Set<string>();
    const note = () => {
      if (live(container)) announcements.add(live(container));
    };
    expect(screen.getByText('In 3 Sekunden geht es weiter.')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(100));
    note();
    act(() => vi.advanceTimersByTime(1000));
    note();
    expect(screen.getByText('In 2 Sekunden geht es weiter.')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    note();
    expect(onEnd).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    act(() => vi.advanceTimersByTime(100));
    note();
    expect(screen.getAllByText('Du kannst weitermachen.').length).toBeGreaterThan(0);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect([...announcements]).toEqual(['In 3 Sekunden geht es weiter.', 'Du kannst weitermachen.']);
  });

  it('hides the ticking number from screen readers', () => {
    render(<Countdown until={Date.now() + 5000} format={format} done="fertig" />);
    expect(screen.getByText('In 5 Sekunden geht es weiter.')).toHaveAttribute('aria-hidden', 'true');
  });

  it('is over at once when the moment already passed', () => {
    const onEnd = vi.fn();
    render(<Countdown until={Date.now() - 1} format={format} done="fertig" onEnd={onEnd} />);
    expect(screen.getByText('fertig')).toBeInTheDocument();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('announces a second wait again when a new deadline arrives', () => {
    const { container, rerender } = render(<Countdown until={Date.now() + 2000} format={format} done="fertig" />);
    act(() => vi.advanceTimersByTime(2_500));
    act(() => vi.advanceTimersByTime(100));
    expect(live(container)).toBe('fertig');
    rerender(<Countdown until={Date.now() + 9000} format={format} done="fertig" />);
    act(() => vi.advanceTimersByTime(100));
    expect(live(container)).toBe('In 9 Sekunden geht es weiter.');
    expect(screen.getAllByText('In 9 Sekunden geht es weiter.')).toHaveLength(2); // visible and announced
  });
});
