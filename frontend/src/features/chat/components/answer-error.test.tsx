import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelInfo } from '@/shared/api/types';
import { TooltipProvider } from '@/shared/ui';
import de from '../../../../messages/de.json';
import { ChatSettingsProvider, useChatSettings } from '../chat-settings';
import type { RunError } from '../stream/stream-reducer';
import { AnswerError } from './answer-error';

const model = (id: string, label: string): ModelInfo => ({
  id,
  label,
  tier: 'balanced',
  input_usd_per_mtok: 1,
  output_usd_per_mtok: 5,
  cache_read_usd_per_mtok: 0.1,
  efforts: [],
  default_effort: null,
  available: true,
});

function PickerState() {
  return <output data-testid="picker">{useChatSettings().pickerOpen ? 'open' : 'closed'}</output>;
}

function setup(error: Partial<RunError>) {
  const onRetry = vi.fn();
  const onRetryWith = vi.fn();
  const client = new QueryClient();
  client.setQueryData(['config'], {
    models: [model('claude-haiku-4-5', 'Claude Haiku 4.5'), model('claude-sonnet-5-5', 'Claude Sonnet 5.5')],
    default_model: 'claude-sonnet-5-5',
  });
  client.setQueryData(['preferences'], { default_model: 'claude-sonnet-5-5', effort: 'low', style: 'concise' });
  const full: RunError = { code: 'LLM_OVERLOADED', partial: false, requestId: 'req_1', retryAfter: null, params: {}, ...error };
  render(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Berlin">
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <ChatSettingsProvider>
            <AnswerError error={full} model="claude-sonnet-5-5" onRetry={onRetry} onRetryWith={onRetryWith} />
            <PickerState />
          </ChatSettingsProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return { onRetry, onRetryWith };
}

afterEach(() => vi.useRealTimers());

describe('AnswerError', () => {
  it('offers another model when Claude is overloaded', () => {
    const { onRetry, onRetryWith } = setup({ code: 'LLM_OVERLOADED' });
    expect(screen.getByRole('alert')).toHaveTextContent(de.errors.LLM_OVERLOADED);
    fireEvent.click(screen.getByRole('button', { name: de.chat.answer.otherModel }));
    expect(onRetryWith).toHaveBeenCalledWith('claude-haiku-4-5');
    fireEvent.click(screen.getByRole('button', { name: de.chat.answer.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('opens the model picker when the model is not available', () => {
    setup({ code: 'MODEL_UNAVAILABLE', params: { model: 'claude-sonnet-5-5', fallback: 'claude-haiku-4-5' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Claude Sonnet 5.5 ist gerade nicht verfügbar.');
    fireEvent.click(screen.getByRole('button', { name: de.chat.answer.chooseModel }));
    expect(screen.getByTestId('picker')).toHaveTextContent('open');
  });

  it('never says "in 0 seconds" for a rate limit without a known wait (an answer from history)', () => {
    setup({ code: 'LLM_RATE_LIMITED', retryAfter: null, params: {} });
    expect(screen.getByRole('alert')).toHaveTextContent('Versuch es gleich noch einmal.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('0 Sekunden');
  });

  it('leads to the key settings when the key needs a workspace id or was rejected', () => {
    setup({ code: 'LLM_KEY_NEEDS_WORKSPACE' });
    expect(screen.getByRole('alert')).toHaveTextContent(de.errors.LLM_KEY_NEEDS_WORKSPACE);
    expect(screen.getByRole('link', { name: de.chat.answer.keySettings })).toHaveAttribute('href', '/settings?section=models');
  });

  it('waits for the countdown of Claude’s own rate limit before trying again', () => {
    vi.useFakeTimers();
    const { onRetry } = setup({ code: 'LLM_RATE_LIMITED', retryAfter: 30, params: { seconds: 30 } });
    expect(screen.getByText(/Versuch es in 30 Sekunden erneut/)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: de.chat.answer.retry });
    expect(retry).toBeDisabled();
    act(() => vi.advanceTimersByTime(30_500));
    expect(screen.getByRole('button', { name: de.chat.answer.retry })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: de.chat.answer.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('sends a conversation that got too long to a new chat instead of retrying', () => {
    setup({ code: 'LLM_CONTEXT_TOO_LARGE' });
    expect(screen.queryByRole('button', { name: de.chat.answer.retry })).toBeNull();
    expect(screen.getByRole('link', { name: de.chat.answer.newChat })).toHaveAttribute('href', '/chat');
  });

  it('shows the error id of an unexpected failure with a copy action', () => {
    setup({ code: 'INTERNAL_ERROR', requestId: 'req_9f8e7d6c' });
    expect(screen.getByText('Fehler-ID req_9f8e7d6c')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: de.chat.answer.copyErrorId })).toBeInTheDocument();
  });
});
