import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UIProvider } from '@/features/shell';
import { TooltipProvider } from '@/shared/ui';
import de from '../../../../messages/de.json';
import { answerFromMessage, type Answer } from '../answer';
import { ChatSettingsProvider } from '../chat-settings';
import { message } from '../testing';
import type { Comparison } from '../turns';
import { CompareTurn } from './compare-turn';

const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

function answers(): { a: Answer; b: Answer } {
  const common = { comparison_id: 'cmp1', parent_id: 'u1' };
  return {
    a: answerFromMessage(message({ id: 'a1', lane: 'a', is_preferred: true, ...common })),
    b: answerFromMessage(
      message({ id: 'b1', lane: 'b', is_preferred: false, model: 'claude-haiku-4-5', cost_usd: 0.0004, latency_ms: { ttft: 410, total: 1200 }, ...common }),
    ),
  };
}

function setup(comparison: Comparison, canRegenerate = true) {
  const handlers = { onRegenerate: vi.fn(), onStop: vi.fn(), onPrefer: vi.fn() };
  // The config is preset; a refetch must not reach the network (it would mark the backend down).
  vi.stubGlobal('fetch', () => new Promise(() => undefined));
  const client = new QueryClient();
  client.setQueryData(['config'], { models: MODELS.map((m) => ({ ...m, available: true, efforts: [], tier: 'fast' })) });
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Berlin">
      <QueryClientProvider client={client}>
        <UIProvider>
          <TooltipProvider>
            <ChatSettingsProvider>
              <CompareTurn comparison={comparison} chatTitle="Mira" canRegenerate={canRegenerate} {...handlers} />
            </ChatSettingsProvider>
          </TooltipProvider>
        </UIProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return handlers;
}

afterEach(() => vi.unstubAllGlobals());

describe('CompareTurn', () => {
  it('shows both columns with model, times, tokens and cost, and the kept answer', () => {
    const { a, b } = answers();
    setup({ id: 'cmp1', a, b, preferred: 'a' });
    const sonnet = screen.getByRole('region', { name: 'Antwort von Claude Sonnet 5.5' });
    const haiku = screen.getByRole('region', { name: 'Antwort von Claude Haiku 4.5' });
    expect(within(sonnet).getByText('Behalten')).toBeInTheDocument();
    expect(within(sonnet).getByText('0,9 s')).toBeInTheDocument(); // first text, from the saved answer
    expect(within(haiku).getByText('0,4 s')).toBeInTheDocument();
    expect(within(haiku).getByText('1,2 s')).toBeInTheDocument();
    expect(within(haiku).getByText('412 rein, 96 raus')).toBeInTheDocument();
    expect(screen.getByText('Folgefragen bauen auf der Antwort von Claude Sonnet 5.5 auf.')).toBeInTheDocument();
  });

  it('keeps the other answer on request', () => {
    const { a, b } = answers();
    const { onPrefer } = setup({ id: 'cmp1', a, b, preferred: 'a' });
    const haiku = screen.getByRole('region', { name: 'Antwort von Claude Haiku 4.5' });
    fireEvent.click(within(haiku).getByRole('button', { name: 'Diese Antwort behalten' }));
    expect(onPrefer).toHaveBeenCalledWith(b);
  });

  it('stops one running column and shows the failed one with a retry of its own', () => {
    const { a, b } = answers();
    const running: Answer = { ...a, status: 'streaming', live: true, phase: 'generating', startedAt: Date.now(), latency: null };
    const failed: Answer = { ...b, status: 'error', text: '', error: { code: 'LLM_OVERLOADED', partial: false, requestId: 'req_9', retryAfter: null, params: {} } };
    const { onStop, onRegenerate } = setup({ id: 'cmp1', a: running, b: failed, preferred: 'a' });
    const sonnet = screen.getByRole('region', { name: 'Antwort von Claude Sonnet 5.5' });
    fireEvent.click(within(sonnet).getByRole('button', { name: 'Stoppen' }));
    expect(onStop).toHaveBeenCalledWith('a');
    const haiku = screen.getByRole('region', { name: 'Antwort von Claude Haiku 4.5' });
    expect(within(haiku).getByRole('alert')).toHaveTextContent(de.errors.LLM_OVERLOADED);
    expect(within(haiku).queryByRole('button', { name: de.chat.answer.otherModel })).toBeNull();
    fireEvent.click(within(haiku).getByRole('button', { name: de.chat.answer.retry }));
    expect(onRegenerate).toHaveBeenCalledWith(failed);
    expect(within(haiku).queryByRole('button', { name: 'Diese Antwort behalten' })).toBeNull();
  });
});
