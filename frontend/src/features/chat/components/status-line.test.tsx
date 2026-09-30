import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import de from '../../../../messages/de.json';
import { SLOW_AFTER_MS, StatusLine } from './status-line';

function renderLine(phase: 'retrieving' | 'generating' | 'retrying', startedAt: number | null) {
  render(
    <NextIntlClientProvider locale="de" messages={de}>
      <StatusLine phase={phase} startedAt={startedAt} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('StatusLine', () => {
  it('names the phase', () => {
    renderLine('retrying', null);
    expect(screen.getByText('Neuer Versuch')).toBeInTheDocument();
  });

  it('says it takes longer after 8 s without text', () => {
    renderLine('retrieving', Date.now());
    expect(screen.queryByText('Dauert länger als üblich')).toBeNull();
    act(() => vi.advanceTimersByTime(SLOW_AFTER_MS));
    expect(screen.getByText('Dauert länger als üblich')).toBeInTheDocument();
  });

  it('never calls streaming text slow', () => {
    renderLine('generating', null);
    act(() => vi.advanceTimersByTime(SLOW_AFTER_MS * 2));
    expect(screen.queryByText('Dauert länger als üblich')).toBeNull();
  });
});
